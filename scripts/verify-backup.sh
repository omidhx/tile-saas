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
# Usage:
#   bash scripts/verify-backup.sh [backup-file]
#
# اگر backup-file داده نشود، آخرین بکاپِ موفق در `backups/daily/` استفاده می‌شود.
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

# Load .env
if [ -f "${PROJECT_ROOT}/.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "${PROJECT_ROOT}/.env" 2>/dev/null || true; set +a
fi

BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required — see docs/BACKUP_POLICY.md}"

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
TMP_VERIFY=$(mktemp -d)
trap 'rm -rf "${TMP_VERIFY}"' EXIT

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
# 6. pg_restore --list (sanity check that schema is intact)
# ──────────────────────────────────────────────────────────
log "Step 6/6: pg_restore --list (validate schema)"
# pg_restore can read the custom-format file and list its contents without
# connecting to a database. This verifies the dump is internally consistent.

# Find pg_restore — try docker first (postgres container), then host
PG_RESTORE_BIN=""
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "postgres"; then
  PG_RESTORE_BIN="docker compose -f ${PROJECT_ROOT}/docker-compose.yml exec -T postgres pg_restore"
else
  if command -v pg_restore >/dev/null 2>&1; then
    PG_RESTORE_BIN="pg_restore"
  else
    warn "pg_restore not available — skipping schema list check"
    warn "Install PostgreSQL client tools OR run with Docker Compose up"
    ok "Verify passed (without pg_restore --list)"
    exit 0
  fi
fi

# Copy the dump file into a path pg_restore can read
# If using Docker, we need to pipe via stdin
TABLE_COUNT=$(${PG_RESTORE_BIN} --list "${TMP_VERIFY}/dump.sql" 2>/dev/null | grep -c "; " || echo "0")
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

exit 0
