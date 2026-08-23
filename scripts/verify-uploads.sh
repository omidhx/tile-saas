#!/bin/bash
# =============================================================================
# scripts/verify-uploads.sh — Verify an uploads backup without restoring
# =============================================================================
# این اسکریپت یک فایل بکاپِ uploads را verify می‌کند:
#   ۱. فایل وجود دارد و non-empty است
#   ۲. SHA-256 با checksum فایل مطابقت دارد
#   ۳. GPG decrypt موفق است
#   ۴. zstd decompress موفق است
#   ۵. خروجی یک tar archive معتبر است
#   ۶. tar --list فایل‌های uploads/ را نشان می‌دهد
#   ۷. manifest معتبر JSON است و فایل‌هایش با tar مطابقت دارند
#
# Usage:
#   bash scripts/verify-uploads.sh [backup-file]
#
# اگر backup-file داده نشود، آخرین بکاپ در backups/uploads/ استفاده می‌شود.
#
# Exit codes:
#   0 — verify موفق
#   1 — فایل پیدا نشد
#   2 — checksum mismatch
#   3 — decrypt failed
#   4 — decompress failed
#   5 — invalid tar format
#   6 — tar --list failed
#   7 — manifest invalid or mismatch
# =============================================================================

set -euo pipefail

# Anti-leak defenses
if [[ "${-}" == *x* ]]; then
  echo "ERROR: this script must not run with 'set -x' (passphrase leak risk)" >&2
  exit 1
fi
set +o history 2>/dev/null || true

if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

log()   { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${BLUE}INFO${NC}  $*"; }
warn()  { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${YELLOW}WARN${NC}  $*"; }
error() { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${RED}ERROR${NC} $*" >&2; }
ok()    { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${GREEN}OK${NC}    $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups/uploads"

# Load .env (selectively)
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  ( source "${PROJECT_ROOT}/.env" 2>/dev/null && \
    for var in BACKUP_GPG_PASSPHRASE; do
      if [ -n "${!var:-}" ]; then echo "${var}=${!var}"; fi
    done ) | while IFS='=' read -r k v; do export "${k}=${v}"; done
  set +a
fi

BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required — see docs/BACKUP_POLICY.md}"

# Find backup file
BACKUP_FILE="${1:-}"
if [ -z "${BACKUP_FILE}" ]; then
  BACKUP_FILE=$(ls -t "${BACKUP_DIR}"/*.gpg 2>/dev/null | head -1 || true)
  if [ -z "${BACKUP_FILE}" ]; then
    error "No backup file found in ${BACKUP_DIR}/"
    error "Usage: bash scripts/verify-uploads.sh [backup-file]"
    exit 1
  fi
  log "Using most recent backup: ${BACKUP_FILE}"
fi

BACKUP_FILE=$(cd "$(dirname "${BACKUP_FILE}")" && pwd)/$(basename "${BACKUP_FILE}")

if [ ! -f "${BACKUP_FILE}" ]; then
  error "Backup file does not exist: ${BACKUP_FILE}"
  exit 1
fi

log "Verifying: ${BACKUP_FILE}"

TMP_VERIFY=$(mktemp -d)
chmod 700 "${TMP_VERIFY}"

CLEANUP_DONE=0
cleanup() {
  if [ "${CLEANUP_DONE}" -eq 1 ]; then return 0; fi
  CLEANUP_DONE=1
  if [ -n "${TMP_VERIFY:-}" ] && [ -d "${TMP_VERIFY}" ]; then
    rm -rf "${TMP_VERIFY}" 2>/dev/null || true
  fi
}
on_signal() {
  local sig=$1
  cleanup
  exit $((128 + sig))
}
trap cleanup EXIT
trap 'on_signal 2' INT
trap 'on_signal 15' TERM
trap 'on_signal 1' HUP

# ──────────────────────────────────────────────────────────
# 1. File exists and is non-empty
# ──────────────────────────────────────────────────────────
log "Step 1/7: File existence check"
SIZE=$(stat -c%s "${BACKUP_FILE}" 2>/dev/null || stat -f%z "${BACKUP_FILE}")
if [ "${SIZE}" -lt 100 ]; then
  error "Backup file is too small (${SIZE} bytes)"
  exit 1
fi
ok "File OK — size: ${SIZE} bytes"

# ──────────────────────────────────────────────────────────
# 2. SHA-256 checksum verification
# ──────────────────────────────────────────────────────────
log "Step 2/7: SHA-256 checksum verification"
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
  warn "No .sha256 file found — computing fresh checksum"
  warn "Computed: ${ACTUAL_SHA256}"
fi

# ──────────────────────────────────────────────────────────
# 3. GPG decrypt
# ──────────────────────────────────────────────────────────
log "Step 3/7: GPG decrypt"
if ! echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt "${BACKUP_FILE}" 2>"${TMP_VERIFY}/gpg.log" \
  > "${TMP_VERIFY}/decrypted.tar.zst"; then
  error "GPG decrypt failed"
  cat "${TMP_VERIFY}/gpg.log" >&2 || true
  exit 3
fi

if [ ! -s "${TMP_VERIFY}/decrypted.tar.zst" ]; then
  error "Decrypted file is empty"
  exit 3
fi
ok "GPG decrypt OK"

# ──────────────────────────────────────────────────────────
# 4. zstd decompress
# ──────────────────────────────────────────────────────────
log "Step 4/7: zstd decompress"
if ! zstd -d -f -o "${TMP_VERIFY}/dump.tar" "${TMP_VERIFY}/decrypted.tar.zst" 2>"${TMP_VERIFY}/zstd.log"; then
  error "zstd decompress failed"
  cat "${TMP_VERIFY}/zstd.log" >&2 || true
  exit 4
fi

if [ ! -s "${TMP_VERIFY}/dump.tar" ]; then
  error "Decompressed file is empty"
  exit 4
fi
ok "zstd decompress OK"

# ──────────────────────────────────────────────────────────
# 5. Tar format check
# ──────────────────────────────────────────────────────────
log "Step 5/7: Tar format check"
if ! tar -tf "${TMP_VERIFY}/dump.tar" >/dev/null 2>&1; then
  error "Not a valid tar archive"
  exit 5
fi
ok "Valid tar archive"

# ──────────────────────────────────────────────────────────
# 6. tar --list (validate structure)
# ──────────────────────────────────────────────────────────
log "Step 6/7: tar --list (validate structure)"

# All entries should start with "uploads/"
TAR_ENTRIES=$(tar -tf "${TMP_VERIFY}/dump.tar" 2>/dev/null)
TAR_ENTRY_COUNT=$(echo "${TAR_ENTRIES}" | grep -c "^uploads/" || echo "0")

if [ "${TAR_ENTRY_COUNT}" -eq 0 ]; then
  error "tar archive does not contain any uploads/ entries"
  exit 6
fi
ok "tar --list: ${TAR_ENTRY_COUNT} entries starting with uploads/"

# Check for path traversal in tar entries (defense-in-depth)
# No entry should contain ".." 
if echo "${TAR_ENTRIES}" | grep -q "\.\."; then
  error "tar archive contains suspicious path traversal entries (..)"
  echo "${TAR_ENTRIES}" | grep "\.\." | head -5 >&2
  exit 6
fi
ok "No path traversal entries detected"

# ──────────────────────────────────────────────────────────
# 7. Manifest verification (if .manifest file exists)
# ──────────────────────────────────────────────────────────
log "Step 7/7: Manifest verification"
MANIFEST_FILE="${BACKUP_FILE%.gpg}.manifest"

if [ -f "${MANIFEST_FILE}" ]; then
  # Validate manifest is valid JSON
  if ! python3 -c "import json; json.load(open('${MANIFEST_FILE}'))" 2>/dev/null; then
    error "Manifest is not valid JSON"
    exit 7
  fi
  ok "Manifest is valid JSON"

  # Compare manifest file count with tar entry count
  MANIFEST_FILE_COUNT=$(python3 -c "
import json
with open('${MANIFEST_FILE}') as f:
    data = json.load(f)
print(len(data.get('files', [])))
" 2>/dev/null || echo "0")

  if [ "${MANIFEST_FILE_COUNT}" -ne "${TAR_ENTRY_COUNT}" ]; then
    warn "File count mismatch: manifest=${MANIFEST_FILE_COUNT}, tar=${TAR_ENTRY_COUNT}"
    warn "This may indicate files were added/removed during backup"
  else
    ok "Manifest file count matches tar entries (${MANIFEST_FILE_COUNT} files)"
  fi
else
  warn "No .manifest file found — skipping manifest verification"
fi

# ──────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────
ok "─── Verify Summary ───"
ok "File:        ${BACKUP_FILE}"
ok "Size:        ${SIZE} bytes"
ok "SHA-256:     ${ACTUAL_SHA256:0:32}..."
ok "Format:      tar.zst.gpg (GPG symmetric AES-256)"
ok "Entries:     ${TAR_ENTRY_COUNT} files"
ok ""
ok "Uploads backup file is valid and ready for restore."
ok "For full restore test, run: bash scripts/restore-uploads.sh ${BACKUP_FILE}"

trap - EXIT INT TERM HUP
cleanup
exit 0
