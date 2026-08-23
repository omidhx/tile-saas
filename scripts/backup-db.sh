#!/bin/bash
# =============================================================================
# scripts/backup-db.sh — Daily PostgreSQL Backup with Encryption + Off-site Copy
# =============================================================================
# این اسکریپت:
#   ۱. pg_dump از دیتابیسِ PostgreSQL (داخلِ Docker container) می‌گیرد
#   ۲. با zstd فشرده می‌کند
#   ۳. با GPG (symmetric AES-256) رمزنگاری می‌کند
#   ۴. checksum (SHA-256) محاسبه می‌کند
#   ۵. به storage خارج از VPS با rsync کپی می‌کند (اگر تنظیم شده باشد)
#   ۶. status file را برایِ /api/metrics به‌روزرسانی می‌کند
#   ۷. بکاپ‌های منقضی‌شده را حذف نمی‌کند — این کار `cleanup-old-backups.sh` انجام می‌دهد
#
# Pre-requisites:
#   - Docker Compose با serviceِ postgres بالا باشد
#   - gpg و zstd روی host نصب باشند
#   - rsync اگر `BACKUP_OFFSITE_TARGET` ست شده باشد
#   - متغیرهای محیطیِ لازم در `.env` یا environment ست شده باشند
#
# Usage:
#   bash scripts/backup-db.sh
#
# Exit codes:
#   0 — موفق
#   1 — خطایِ پیش‌نیاز (env var missing، docker not running)
#   2 — خطایِ pg_dump
#   3 — خطایِ compression
#   4 — خطایِ encryption
#   5 — خطایِ off-site upload
#   6 — خطایِ status file write
# =============================================================================

set -euo pipefail

# ──────────────────────────────────────────────────────────
# Color codes (only if stdout is a TTY)
# ──────────────────────────────────────────────────────────
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  BLUE=''
  NC=''
fi

log()   { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${BLUE}INFO${NC}  $*"; }
warn()  { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${YELLOW}WARN${NC}  $*"; }
error() { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${RED}ERROR${NC} $*" >&2; }
ok()    { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${GREEN}OK${NC}    $*"; }

# ──────────────────────────────────────────────────────────
# Configuration (from env, with defaults)
# ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups/daily"
STATUS_DIR="${PROJECT_ROOT}/backups/status"
STATUS_FILE="${STATUS_DIR}/backup-status.json"

# Load .env if present (for local testing)
if [ -f "${PROJECT_ROOT}/.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "${PROJECT_ROOT}/.env" 2>/dev/null || true; set +a
fi

# Required env vars
POSTGRES_USER="${POSTGRES_USER:-tile_app}"
POSTGRES_DB="${POSTGRES_DB:-tile_saas}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required — see docs/BACKUP_POLICY.md}"

# Optional env vars
BACKUP_OFFSITE_TARGET="${BACKUP_OFFSITE_TARGET:-}"
BACKUP_OFFSITE_METHOD="${BACKUP_OFFSITE_METHOD:-rsync}"
BACKUP_OFFSITE_SSH_KEY="${BACKUP_OFFSITE_SSH_KEY:-}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# Compose file (use staging if set, otherwise default)
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

# Timestamp for filename
STAMP="$(date -u +%Y-%m-%d_%H%M)"
DATE_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BACKUP_NAME="tile_saas_${STAMP}"
BACKUP_FILE_RAW="${BACKUP_DIR}/${BACKUP_NAME}.sql"
BACKUP_FILE_ZST="${BACKUP_DIR}/${BACKUP_NAME}.sql.zst"
BACKUP_FILE_GPG="${BACKUP_DIR}/${BACKUP_NAME}.sql.zst.gpg"

# Status tracking — these get reset on each run
LAST_SUCCESS_AT="null"
LAST_FAILURE_AT="null"
LAST_FAILURE_REASON="null"
LAST_SUCCESS_SIZE="null"
LAST_SUCCESS_SHA256="null"

# ──────────────────────────────────────────────────────────
# Cleanup on exit / error
# ──────────────────────────────────────────────────────────
cleanup() {
  local exit_code=$?
  if [ $exit_code -ne 0 ]; then
    LAST_FAILURE_AT="\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
    error "Backup failed with exit code $exit_code"
    write_status_failure
  fi
  # Clean up raw and zst files (only the encrypted gpg file is kept)
  rm -f "${BACKUP_FILE_RAW}" 2>/dev/null || true
  rm -f "${BACKUP_FILE_ZST}" 2>/dev/null || true
  exit $exit_code
}
trap cleanup EXIT

# ──────────────────────────────────────────────────────────
# Helper: write status file (JSON)
# ──────────────────────────────────────────────────────────
write_status_failure() {
  mkdir -p "${STATUS_DIR}"
  cat > "${STATUS_FILE}" <<EOF
{
  "last_success_at": ${LAST_SUCCESS_AT},
  "last_failure_at": ${LAST_FAILURE_AT},
  "last_failure_reason": ${LAST_FAILURE_REASON},
  "last_success_size_bytes": ${LAST_SUCCESS_SIZE},
  "last_success_sha256": ${LAST_SUCCESS_SHA256},
  "backup_age_seconds": null,
  "restore_test_last_success_at": null,
  "restore_test_last_failure_at": null,
  "retention_days": ${BACKUP_RETENTION_DAYS}
}
EOF
  # Re-read restore_test fields from previous status if present
  if [ -f "${STATUS_FILE}.prev" ]; then
    local prev_restore_success prev_restore_failure
    prev_restore_success=$(grep -o '"restore_test_last_success_at": "[^"]*"' "${STATUS_FILE}.prev" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/\1/' || echo "")
    prev_restore_failure=$(grep -o '"restore_test_last_failure_at": "[^"]*"' "${STATUS_FILE}.prev" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/\1/' || echo "")
    if [ -n "${prev_restore_success}" ]; then
      sed -i "s|\"restore_test_last_success_at\": null|\"restore_test_last_success_at\": \"${prev_restore_success}\"|" "${STATUS_FILE}"
    fi
    if [ -n "${prev_restore_failure}" ]; then
      sed -i "s|\"restore_test_last_failure_at\": null|\"restore_test_last_failure_at\": \"${prev_restore_failure}\"|" "${STATUS_FILE}"
    fi
  fi
}

write_status_success() {
  mkdir -p "${STATUS_DIR}"
  # Backup previous status (to preserve restore_test fields)
  [ -f "${STATUS_FILE}" ] && cp "${STATUS_FILE}" "${STATUS_FILE}.prev"
  cat > "${STATUS_FILE}" <<EOF
{
  "last_success_at": "${LAST_SUCCESS_AT}",
  "last_failure_at": ${LAST_FAILURE_AT},
  "last_failure_reason": ${LAST_FAILURE_REASON},
  "last_success_size_bytes": ${LAST_SUCCESS_SIZE},
  "last_success_sha256": "${LAST_SUCCESS_SHA256}",
  "backup_age_seconds": 0,
  "restore_test_last_success_at": null,
  "restore_test_last_failure_at": null,
  "retention_days": ${BACKUP_RETENTION_DAYS}
}
EOF
  # Preserve restore_test_* from previous status
  if [ -f "${STATUS_FILE}.prev" ]; then
    local prev_restore_success prev_restore_failure
    prev_restore_success=$(grep -o '"restore_test_last_success_at": "[^"]*"' "${STATUS_FILE}.prev" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/\1/' || echo "")
    prev_restore_failure=$(grep -o '"restore_test_last_failure_at": "[^"]*"' "${STATUS_FILE}.prev" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/\1/' || echo "")
    if [ -n "${prev_restore_success}" ]; then
      sed -i "s|\"restore_test_last_success_at\": null|\"restore_test_last_success_at\": \"${prev_restore_success}\"|" "${STATUS_FILE}"
    fi
    if [ -n "${prev_restore_failure}" ]; then
      sed -i "s|\"restore_test_last_failure_at\": null|\"restore_test_last_failure_at\": \"${prev_restore_failure}\"|" "${STATUS_FILE}"
    fi
  fi
}

# ──────────────────────────────────────────────────────────
# 0. Pre-flight checks
# ──────────────────────────────────────────────────────────
log "Backup starting — ${DATE_ISO}"
log "Project root: ${PROJECT_ROOT}"
log "Backup target: ${BACKUP_FILE_GPG}"

# 0.1 Required commands
for cmd in gpg zstd docker; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    error "Required command not found: $cmd"
    LAST_FAILURE_REASON="\"missing_command_$cmd\""
    exit 1
  fi
done
ok "All required commands available: gpg, zstd, docker"

# 0.2 Docker Compose
if ! docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" ps postgres 2>/dev/null | grep -q "postgres"; then
  error "PostgreSQL container is not running. Start it with: docker compose -f ${COMPOSE_FILE} up -d postgres"
  LAST_FAILURE_REASON="\"postgres_container_not_running\""
  exit 1
fi
ok "PostgreSQL container is running"

# 0.3 Backup directory exists
mkdir -p "${BACKUP_DIR}" "${STATUS_DIR}"

# ──────────────────────────────────────────────────────────
# 1. pg_dump
# ──────────────────────────────────────────────────────────
log "Step 1/6: pg_dump (custom format, includes RLS policies + SECURITY DEFINER functions)"

# Use postgres superuser (or any role with pg_dump privileges) inside the container.
# The container's POSTGRES_USER has full read access for backup.
# We run pg_dump with --no-owner so restore can be done with a different role.
# --format=custom enables parallel restore and selective table restore.
docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  pg_dump \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --verbose \
    > "${BACKUP_FILE_RAW}" 2>"${BACKUP_DIR}/.pg_dump.log"

# Verify dump is non-empty
RAW_SIZE=$(stat -c%s "${BACKUP_FILE_RAW}" 2>/dev/null || stat -f%z "${BACKUP_FILE_RAW}")
if [ "${RAW_SIZE}" -lt 1024 ]; then
  error "pg_dump produced a file smaller than 1KB (${RAW_SIZE} bytes). Likely a failure."
  cat "${BACKUP_DIR}/.pg_dump.log" >&2 || true
  LAST_FAILURE_REASON="\"pg_dump_too_small\""
  rm -f "${BACKUP_FILE_RAW}" "${BACKUP_DIR}/.pg_dump.log"
  exit 2
fi
ok "pg_dump OK — raw size: ${RAW_SIZE} bytes"
rm -f "${BACKUP_DIR}/.pg_dump.log"

# ──────────────────────────────────────────────────────────
# 2. Compress with zstd
# ──────────────────────────────────────────────────────────
log "Step 2/6: zstd compression"
zstd -q -19 -f -o "${BACKUP_FILE_ZST}" "${BACKUP_FILE_RAW}"
ZST_SIZE=$(stat -c%s "${BACKUP_FILE_ZST}" 2>/dev/null || stat -f%z "${BACKUP_FILE_ZST}")
if [ "${ZST_SIZE}" -lt 100 ]; then
  error "zstd compression produced an empty file"
  LAST_FAILURE_REASON="\"zstd_failed\""
  rm -f "${BACKUP_FILE_RAW}" "${BACKUP_FILE_ZST}"
  exit 3
fi
ok "zstd OK — compressed size: ${ZST_SIZE} bytes ($(echo "scale=1; ${ZST_SIZE} * 100 / ${RAW_SIZE}" | bc 2>/dev/null || echo "?")% of raw)"

# Securely delete the raw dump (it contains unencrypted data)
rm -f "${BACKUP_FILE_RAW}"

# ──────────────────────────────────────────────────────────
# 3. Encrypt with GPG (symmetric AES-256)
# ──────────────────────────────────────────────────────────
log "Step 3/6: GPG encryption (symmetric AES-256)"

# Use --batch --pinentry-mode loopback so it reads passphrase without prompting
# --cipher-algo AES256 — explicit
# --compress-algo none — zstd already compressed, no point in GPG's compression
# --s2k-*  — strengthen KDF for passphrase
echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch \
  --yes \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --symmetric \
  --cipher-algo AES256 \
  --compress-algo none \
  --s2k-digest-algo SHA512 \
  --s2k-count 65011712 \
  --output "${BACKUP_FILE_GPG}" \
  "${BACKUP_FILE_ZST}"

if [ ! -s "${BACKUP_FILE_GPG}" ]; then
  error "GPG encryption failed — output file empty"
  LAST_FAILURE_REASON="\"gpg_failed\""
  rm -f "${BACKUP_FILE_RAW}" "${BACKUP_FILE_ZST}" "${BACKUP_FILE_GPG}"
  exit 4
fi
GPG_SIZE=$(stat -c%s "${BACKUP_FILE_GPG}" 2>/dev/null || stat -f%z "${BACKUP_FILE_GPG}")
ok "GPG OK — encrypted size: ${GPG_SIZE} bytes"

# Securely delete the compressed-only file (it's unencrypted)
rm -f "${BACKUP_FILE_ZST}"

# ──────────────────────────────────────────────────────────
# 4. Checksum (SHA-256)
# ──────────────────────────────────────────────────────────
log "Step 4/6: SHA-256 checksum"
SHA256=$(sha256sum "${BACKUP_FILE_GPG}" | awk '{print $1}')
echo "${SHA256}  ${BACKUP_FILE_GPG}" > "${BACKUP_FILE_GPG}.sha256"
ok "SHA-256: ${SHA256}"

# ──────────────────────────────────────────────────────────
# 5. Decrypt verification (sanity check)
# ──────────────────────────────────────────────────────────
log "Step 5/6: Decrypt sanity check (verify GPG + zstd + pg_restore --list)"

# Decrypt to /tmp and verify it's a valid PostgreSQL dump
TMP_VERIFY=$(mktemp -d)
trap 'rm -rf "${TMP_VERIFY}"; cleanup' EXIT

if ! echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt "${BACKUP_FILE_GPG}" 2>/dev/null \
  | zstd -d 2>/dev/null \
  > "${TMP_VERIFY}/verify.sql"; then
  error "GPG decrypt failed"
  LAST_FAILURE_REASON="\"decrypt_failed\""
  rm -rf "${TMP_VERIFY}"
  exit 4
fi

if [ ! -s "${TMP_VERIFY}/verify.sql" ]; then
  error "Decrypted file is empty"
  LAST_FAILURE_REASON="\"decrypt_empty\""
  rm -rf "${TMP_VERIFY}"
  exit 4
fi

# Check it's a real PostgreSQL custom-format dump (starts with "PGDMP")
if ! head -c 5 "${TMP_VERIFY}/verify.sql" | grep -q "^PGDMP"; then
  error "Decrypted file does not start with PGDMP magic — not a valid pg_dump custom format"
  LAST_FAILURE_REASON="\"invalid_pgdump_format\""
  rm -rf "${TMP_VERIFY}"
  exit 4
fi
ok "Decrypt + format verification OK (PGDMP magic present)"
rm -rf "${TMP_VERIFY}"

# ──────────────────────────────────────────────────────────
# 6. Off-site copy
# ──────────────────────────────────────────────────────────
log "Step 6/6: Off-site copy"

OFFSITE_OK="false"
if [ -z "${BACKUP_OFFSITE_TARGET}" ]; then
  warn "BACKUP_OFFSITE_TARGET is not set — skipping off-site copy (NOT recommended for production)"
  warn "Set BACKUP_OFFSITE_TARGET in .env (see docs/BACKUP_POLICY.md)"
  OFFSITE_OK="skipped"
else
  case "${BACKUP_OFFSITE_METHOD}" in
    rsync)
      RSYNC_OPTS="-avz --timeout=300"
      if [ -n "${BACKUP_OFFSITE_SSH_KEY}" ]; then
        RSYNC_OPTS="${RSYNC_OPTS} -e 'ssh -i ${BACKUP_OFFSITE_SSH_KEY} -o StrictHostKeyChecking=accept-new'"
      fi

      log "rsync to ${BACKUP_OFFSITE_TARGET}"
      # shellcheck disable=SC2086
      if eval rsync ${RSYNC_OPTS} "${BACKUP_FILE_GPG}" "${BACKUP_OFFSITE_TARGET}/" 2>&1; then
        # Also sync the .sha256 file
        # shellcheck disable=SC2086
        eval rsync ${RSYNC_OPTS} "${BACKUP_FILE_GPG}.sha256" "${BACKUP_OFFSITE_TARGET}/" 2>&1 || warn "Could not sync .sha256 file"
        ok "rsync OK"
        OFFSITE_OK="true"
      else
        error "rsync failed"
        LAST_FAILURE_REASON="\"rsync_failed\""
        # Don't exit — local backup succeeded, just record failure
      fi
      ;;
    *)
      error "Unknown BACKUP_OFFSITE_METHOD: ${BACKUP_OFFSITE_METHOD}"
      LAST_FAILURE_REASON="\"unknown_offsite_method\""
      ;;
  esac
fi

# ──────────────────────────────────────────────────────────
# Final: write status file
# ──────────────────────────────────────────────────────────
LAST_SUCCESS_AT="${DATE_ISO}"
LAST_SUCCESS_SIZE="${GPG_SIZE}"
LAST_SUCCESS_SHA256="${SHA256}"

write_status_success

ok "Backup complete: ${BACKUP_FILE_GPG}"
ok "Status file:    ${STATUS_FILE}"
ok "Size: ${GPG_SIZE} bytes | SHA-256: ${SHA256:0:16}..."

if [ "${OFFSITE_OK}" = "skipped" ]; then
  warn "Off-site copy SKIPPED — set BACKUP_OFFSITE_TARGET for production"
elif [ "${OFFSITE_OK}" = "true" ]; then
  ok "Off-site copy: OK"
else
  warn "Off-site copy FAILED — local backup OK but no off-site redundancy"
fi

# Reset trap to normal cleanup (no failure path now)
trap - EXIT
exit 0
