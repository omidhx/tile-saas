#!/bin/bash
# =============================================================================
# scripts/verify-backup.sh — Verify a Backup File Without Restoring
# =============================================================================
# این اسکریپت یک فایل بکاپ را بدونِ restore کامل verify می‌کند:
#   ۱. فایل وجود دارد و non-empty است
#   ۲. SHA-256 با checksum فایل مطابقت دارد (اگر .sha256 موجود باشد)
#   ۳. GPG decrypt موفق است
#   ۴. zstd decompress موفق است
#   ۵. خروجی یک PostgreSQL custom-format dump معتبر است (PGDMP magic)
#   ۶. pg_restore --list خروجی معتبر می‌دهد (همه‌ی جدول‌ها لیست می‌شوند)
#
# این verify سریع است (۲–۵ ثانیه برایِ بکاپِ متوسط) و برایِ monitoring
# روزانه مناسب است. برایِ تستِ واقعیِ restore، از `scripts/restore-db.sh` استفاده کنید.
#
# Security:
#   - Passphrase هرگز در args نیست (stdin از طریقِ --passphrase-fd 0)
#   - gpg stderr به فایلِ موقت هدایت می‌شود (نه به console)
#   - فایلِ decrypt شده در /tmp با chmod 700 ساخته می‌شود و بعداً پاک می‌شود
#   - `set -x` غیرفعال است (passphrase leak prevention)
#
# Usage:
#   bash scripts/verify-backup.sh [backup-file]
#   COMPOSE_FILE=docker-compose.staging.yml bash scripts/verify-backup.sh
#
# Exit codes:
#   0 — verify موفق
#   1 — فایل پیدا نشد
#   2 — checksum mismatch
#   3 — decrypt failed
#   4 — decompress failed
#   5 — invalid pg_dump format
#   6 — pg_restore --list failed
# =============================================================================

set -euo pipefail

# Anti-leak defenses — same as backup-db.sh
if [[ "${-}" == *x* ]]; then
  echo "ERROR: this script must not run with 'set -x' (passphrase leak risk)" >&2
  exit 1
fi
set +o history 2>/dev/null || true

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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups/daily"

# Load .env (selectively, same pattern as backup-db.sh)
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  ( source "${PROJECT_ROOT}/.env" 2>/dev/null && \
    for var in BACKUP_GPG_PASSPHRASE COMPOSE_FILE; do
      if [ -n "${!var:-}" ]; then echo "${var}=${!var}"; fi
    done ) | while IFS='=' read -r k v; do export "${k}=${v}"; done
  set +a
fi

BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required — see docs/BACKUP_POLICY.md}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

# Find backup file to verify
BACKUP_FILE="${1:-}"
if [ -z "${BACKUP_FILE}" ]; then
  # Find the most recent backup file
  BACKUP_FILE=$(ls -t "${BACKUP_DIR}"/*.gpg 2>/dev/null | head -1 || true)
  if [ -z "${BACKUP_FILE}" ]; then
    error "No backup file found in ${BACKUP_DIR}/"
    error "Usage: bash scripts/verify-backup.sh [backup-file]"
    exit 1
  fi
  log "No file specified — using most recent: ${BACKUP_FILE}"
fi

# Resolve to absolute path
BACKUP_FILE=$(cd "$(dirname "${BACKUP_FILE}")" && pwd)/$(basename "${BACKUP_FILE}")

if [ ! -f "${BACKUP_FILE}" ]; then
  error "Backup file does not exist: ${BACKUP_FILE}"
  exit 1
fi

log "Verifying: ${BACKUP_FILE}"

# Temporary directory for all intermediate files (cleaned on exit)
TMP_VERIFY=$(mktemp -d)
chmod 700 "${TMP_VERIFY}"

# Cleanup function — with double-cleanup guard (defined BEFORE trap)
CLEANUP_DONE=0
cleanup() {
  if [ "${CLEANUP_DONE}" -eq 1 ]; then
    return 0
  fi
  CLEANUP_DONE=1
  if [ -n "${TMP_VERIFY:-}" ] && [ -d "${TMP_VERIFY}" ]; then
    rm -rf "${TMP_VERIFY}" 2>/dev/null || true
  fi
}

# Signal handler: cleanup + exit with signal-appropriate code
on_signal() {
  local sig=$1
  cleanup
  exit $((128 + sig))
}

trap cleanup EXIT
trap 'on_signal 2' INT    # SIGINT (Ctrl+C) → exit 130
trap 'on_signal 15' TERM  # SIGTERM (cron kill) → exit 143
trap 'on_signal 1' HUP    # SIGHUP (terminal closed) → exit 129

# ──────────────────────────────────────────────────────────
# 1. File exists and is non-empty
# ──────────────────────────────────────────────────────────
log "Step 1/6: File existence check"
SIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}")
if [ "${SIZE}" -lt 100 ]; then
  error "Backup file is too small (${SIZE} bytes)"
  exit 1
fi
ok "File OK — size: ${SIZE} bytes"

# ──────────────────────────────────────────────────────────
# 2. SHA-256 checksum verification
# ──────────────────────────────────────────────────────────
log "Step 2/6: SHA-256 checksum verification"
SHA256_FILE="${BACKUP_FILE}.sha256"
ACTUAL_SHA256=$(sha256sum "${BACKUP_FILE}" | awk '{print $1}')

if [ -f "${SHA256_FILE}" ]; then
  EXPECTED_SHA256=$(awk '{print $1}' "${SHA256_FILE}")
  if [ "${ACTUAL_SHA256}" != "${EXPECTED_SHA256}" ]; then
    error "Checksum mismatch!"
    error "  Expected: ${EXPECTED_SHA256}"
    error "  Actual:   ${ACTUAL_SHA256}"
    exit 2
  fi
  ok "Checksum OK — ${ACTUAL_SHA256:0:16}..."
else
  warn "No .sha256 file found — computing fresh checksum (no comparison possible)"
  warn "Computed: ${ACTUAL_SHA256}"
fi

# ──────────────────────────────────────────────────────────
# 3. GPG decrypt
# ──────────────────────────────────────────────────────────
log "Step 3/6: GPG decrypt"

# Passphrase via stdin; gpg stderr to temp log (NEVER to console)
if ! echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt "${BACKUP_FILE}" 2>"${TMP_VERIFY}/gpg.log" \
  > "${TMP_VERIFY}/decrypted.zst"; then
  error "GPG decrypt failed"
  cat "${TMP_VERIFY}/gpg.log" >&2 || true
  exit 3
fi

if [ ! -s "${TMP_VERIFY}/decrypted.zst" ]; then
  error "Decrypted file is empty"
  exit 3
fi
ok "GPG decrypt OK"

# ──────────────────────────────────────────────────────────
# 4. zstd decompress
# ──────────────────────────────────────────────────────────
log "Step 4/6: zstd decompress"
if ! zstd -d -f -o "${TMP_VERIFY}/dump.sql" "${TMP_VERIFY}/decrypted.zst" 2>"${TMP_VERIFY}/zstd.log"; then
  error "zstd decompress failed"
  cat "${TMP_VERIFY}/zstd.log" >&2 || true
  exit 4
fi

if [ ! -s "${TMP_VERIFY}/dump.sql" ]; then
  error "Decompressed file is empty"
  exit 4
fi
ok "zstd decompress OK"

# ──────────────────────────────────────────────────────────
# 5. PostgreSQL custom-format magic check
# ──────────────────────────────────────────────────────────
log "Step 5/6: PostgreSQL dump format check (PGDMP magic)"
MAGIC=$(head -c 5 "${TMP_VERIFY}/dump.sql")
if [ "${MAGIC}" != "PGDMP" ]; then
  error "Not a valid pg_dump custom-format file (expected 'PGDMP' magic, got '${MAGIC}')"
  exit 5
fi
ok "PGDMP magic OK"

# ──────────────────────────────────────────────────────────
# 6. pg_restore --list (validate schema)
# ──────────────────────────────────────────────────────────
log "Step 6/6: pg_restore --list (validate schema)"
# pg_restore can read the custom-format file and list its contents without
# connecting to a database. This verifies the dump is internally consistent.

# Build command as an ARRAY (no string splitting, no eval)
# Prefer docker compose (uses COMPOSE_FILE env var) — fall back to host pg_restore
pg_restore_cmd=()
if docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" ps postgres 2>/dev/null | grep -q "postgres"; then
  pg_restore_cmd=(
    docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" exec -T postgres pg_restore
  )
elif command -v pg_restore >/dev/null 2>&1; then
  pg_restore_cmd=(pg_restore)
else
  warn "pg_restore not available — skipping schema list check"
  warn "Install PostgreSQL client tools OR run with Docker Compose up"
  ok "Verify passed (without pg_restore --list)"
  # CLEANUP_DONE guard makes this safe (no double-cleanup)
  cleanup
  exit 0
fi

# Run pg_restore --list, count entries
TABLE_COUNT=$("${pg_restore_cmd[@]}" --list "${TMP_VERIFY}/dump.sql" 2>/dev/null | grep -c "; " || echo "0")
if [ "${TABLE_COUNT}" -lt 10 ]; then
  error "pg_restore --list returned too few entries (${TABLE_COUNT})"
  error "Expected ≥ 10 tables, got ${TABLE_COUNT}"
  exit 6
fi
ok "pg_restore --list OK — ${TABLE_COUNT} entries found"

# ──────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────
ok "─── Verify Summary ───"
ok "File:        ${BACKUP_FILE}"
ok "Size:        ${SIZE} bytes"
ok "SHA-256:     ${ACTUAL_SHA256:0:32}..."
ok "Format:      pg_dump custom (PGDMP)"
ok "Tables:      ${TABLE_COUNT} entries"
ok ""
ok "Backup file is valid and ready for restore."
ok "For full restore test, run: bash scripts/restore-db.sh ${BACKUP_FILE}"

# CLEANUP_DONE guard makes this safe (no double-cleanup)
cleanup
exit 0
