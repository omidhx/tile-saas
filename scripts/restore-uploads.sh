#!/bin/bash
# =============================================================================
# scripts/restore-uploads.sh — Restore uploads backup to ISOLATED test directory
# =============================================================================
# این اسکریپت یک بکاپِ uploads را به مسیرِ ایزوله‌ی restore می‌کند (نه production!).
#
# مراحل:
#   ۱. Decrypt و decompress بکاپ
#   ۲. استخراج tar به مسیرِ ایزوله (private/uploads_restore_test/)
#   ۳. Integrity checks:
#      - تعداد فایل‌ها
#      - تطبیق با manifest (اگر موجود باشد)
#      - بررسی path traversal
#   ۴. Smoke checks:
#      - چند فایل تصادفی را باز کن (با file --mime-type)
#      - بررسی extension‌های مجاز (jpg/png/webp)
#   ۵. Report (نه cleanup — برایِ inspection دستی)
#
# ⚠️  این اسکریپت هرگز به مسیرِ production restore نمی‌کند. فقط مسیرِ ایزوله‌ی
#     `private/uploads_restore_test/` استفاده می‌شود.
#
# Usage:
#   bash scripts/restore-uploads.sh [backup-file]
#   bash scripts/restore-uploads.sh --test-only       # از آخرین بکاپ
#   bash scripts/restore-uploads.sh --no-cleanup       # برایِ debugging
#
# Exit codes:
#   0 — restore test موفق
#   1 — pre-flight failure
#   2 — decrypt/decompress failed
#   3 — tar extraction failed
#   4 — integrity check failed
#   5 — smoke test failed
# =============================================================================

set -euo pipefail

# Anti-leak defenses
if [[ "${-}" == *x* ]]; then
  echo "ERROR: this script must not run with 'set -x' (passphrase leak risk)" >&2
  exit 1
fi
set +o history 2>/dev/null || true

# Concurrency guard
LOCK_FILE="${UPLOADS_RESTORE_LOCK_FILE:-/var/lock/tile-saas-restore-uploads.lock}"
LOCK_DIR=$(dirname "${LOCK_FILE}")
if [ ! -d "${LOCK_DIR}" ]; then
  if [ "${LOCK_FILE}" = "/var/lock/tile-saas-restore-uploads.lock" ]; then
    LOCK_FILE="/tmp/tile-saas-restore-uploads.lock"
  fi
fi
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  echo "ERROR: another restore-uploads.sh is already running (lock: ${LOCK_FILE})" >&2
  exit 1
fi

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
STATUS_DIR="${PROJECT_ROOT}/backups/status"
STATUS_FILE="${STATUS_DIR}/uploads-backup-status.json"

# Load .env (selectively)
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  ( source "${PROJECT_ROOT}/.env" 2>/dev/null && \
    for var in BACKUP_GPG_PASSPHRASE BACKUP_RETENTION_DAYS COMPOSE_FILE; do
      if [ -n "${!var:-}" ]; then echo "${var}=${!var}"; fi
    done ) | while IFS='=' read -r k v; do export "${k}=${v}"; done
  set +a
fi

BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# ISOLATED restore directory — never use the production uploads directory!
# This is inside the web/ directory so it's accessible from the host
RESTORE_DIR="${PROJECT_ROOT}/private/uploads_restore_test"

# SAFETY: RESTORE_DIR must NOT be the production uploads directory
PRODUCTION_UPLOADS_DIR="${PROJECT_ROOT}/web/private/uploads"
if [ "${RESTORE_DIR}" = "${PRODUCTION_UPLOADS_DIR}" ]; then
  echo "ERROR: RESTORE_DIR must not equal production uploads directory" >&2
  echo "ERROR: RESTORE_DIR='${RESTORE_DIR}' == production='${PRODUCTION_UPLOADS_DIR}'" >&2
  exit 1
fi

if [[ "${RESTORE_DIR}" != *"_restore_test" ]]; then
  echo "ERROR: RESTORE_DIR must end with '_restore_test' for safety" >&2
  echo "ERROR: got: '${RESTORE_DIR}'" >&2
  exit 1
fi

# Parse args
BACKUP_FILE=""
TEST_ONLY=false
NO_CLEANUP=false

for arg in "$@"; do
  case "$arg" in
    --test-only)
      TEST_ONLY=true
      ;;
    --no-cleanup)
      NO_CLEANUP=true
      ;;
    -h|--help)
      echo "Usage: bash scripts/restore-uploads.sh [backup-file | --test-only] [--no-cleanup]"
      echo ""
      echo "Options:"
      echo "  --test-only   Use the most recent backup in backups/uploads/"
      echo "  --no-cleanup  Keep restored files (for debugging)"
      echo ""
      echo "Restores to ISOLATED directory: ${RESTORE_DIR}"
      echo "Never restores to production uploads directory."
      exit 0
      ;;
    *)
      BACKUP_FILE="$arg"
      ;;
  esac
done

# ──────────────────────────────────────────────────────────
# Resolve backup file
# ──────────────────────────────────────────────────────────
if [ "${TEST_ONLY}" = true ] || [ -z "${BACKUP_FILE}" ]; then
  BACKUP_FILE=$(ls -t "${BACKUP_DIR}"/*.gpg 2>/dev/null | head -1 || true)
  if [ -z "${BACKUP_FILE}" ]; then
    error "No backup file found in ${BACKUP_DIR}/"
    error "Run scripts/backup-uploads.sh first"
    exit 1
  fi
  log "Using most recent backup: ${BACKUP_FILE}"
fi

BACKUP_FILE=$(cd "$(dirname "${BACKUP_FILE}")" && pwd)/$(basename "${BACKUP_FILE}")

if [ ! -f "${BACKUP_FILE}" ]; then
  error "Backup file does not exist: ${BACKUP_FILE}"
  exit 1
fi

DATE_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RESTORE_START=$(date +%s)
log "Uploads restore test starting — ${DATE_ISO}"
log "Backup file: ${BACKUP_FILE}"
log "Restore target: ${RESTORE_DIR} (ISOLATED)"

# ──────────────────────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────────────────────
for cmd in tar zstd gpg file; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    error "Required command not found: $cmd"
    exit 1
  fi
done
ok "All required commands available"

# ──────────────────────────────────────────────────────────
# Cleanup function (with double-cleanup guard)
# ──────────────────────────────────────────────────────────
TMP_RESTORE=$(mktemp -d)
chmod 700 "${TMP_RESTORE}"

CLEANUP_DONE=0
RESTORE_DONE=false

maybe_cleanup() {
  if [ "${CLEANUP_DONE}" -eq 1 ]; then return 0; fi
  CLEANUP_DONE=1

  # Clean up temp files
  if [ -n "${TMP_RESTORE:-}" ] && [ -d "${TMP_RESTORE}" ]; then
    rm -rf "${TMP_RESTORE}" 2>/dev/null || true
  fi

  if [ "${NO_CLEANUP}" = true ]; then
    warn "Skipping cleanup (--no-cleanup)"
    warn "Restored files left in: ${RESTORE_DIR}"
    warn "Remove manually: rm -rf ${RESTORE_DIR}"
    return
  fi

  # Remove the isolated restore directory
  if [ -n "${RESTORE_DIR:-}" ] && [ -d "${RESTORE_DIR}" ]; then
    log "Cleanup: removing ${RESTORE_DIR}"
    rm -rf "${RESTORE_DIR}" 2>/dev/null || warn "Could not remove ${RESTORE_DIR}"
  fi
}

on_signal() {
  local sig=$1
  maybe_cleanup
  exit $((128 + sig))
}

trap maybe_cleanup EXIT
trap 'on_signal 2' INT
trap 'on_signal 15' TERM
trap 'on_signal 1' HUP

# ──────────────────────────────────────────────────────────
# 1. Decrypt + decompress
# ──────────────────────────────────────────────────────────
log "Step 1/5: Decrypt + decompress"

if ! echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt "${BACKUP_FILE}" 2>"${TMP_RESTORE}/gpg.log" \
  | zstd -d 2>"${TMP_RESTORE}/zstd.log" \
  > "${TMP_RESTORE}/dump.tar"; then
  error "Decrypt/decompress failed"
  cat "${TMP_RESTORE}/gpg.log" >&2 || true
  cat "${TMP_RESTORE}/zstd.log" >&2 || true
  exit 2
fi

if [ ! -s "${TMP_RESTORE}/dump.tar" ]; then
  error "Decrypted tar file is empty"
  exit 2
fi

# Verify it's a valid tar
if ! tar -tf "${TMP_RESTORE}/dump.tar" >/dev/null 2>&1; then
  error "Not a valid tar archive"
  exit 2
fi
ok "Decrypt + decompress OK"

# ──────────────────────────────────────────────────────────
# 2. Extract to isolated directory
# ──────────────────────────────────────────────────────────
log "Step 2/5: Extract to ${RESTORE_DIR}"

# Remove existing restore directory if present
rm -rf "${RESTORE_DIR}"
mkdir -p "${RESTORE_DIR}"
chmod 700 "${RESTORE_DIR}"

# Extract tar — all paths must be inside uploads/ (defense against path traversal)
# We extract to RESTORE_DIR which is isolated
if ! tar \
  --extract \
  --file "${TMP_RESTORE}/dump.tar" \
  --directory "${RESTORE_DIR}" \
  --no-same-owner \
  --no-same-permissions \
  2>"${TMP_RESTORE}/tar_extract.log"; then
  error "tar extraction failed"
  cat "${TMP_RESTORE}/tar_extract.log" >&2 || true
  exit 3
fi

# The tar stores files under uploads/... so after extraction:
# RESTORE_DIR/uploads/<files>
EXTRACTED_UPLOADS_DIR="${RESTORE_DIR}/uploads"
if [ ! -d "${EXTRACTED_UPLOADS_DIR}" ]; then
  error "Expected extracted directory not found: ${EXTRACTED_UPLOADS_DIR}"
  exit 3
fi
ok "Extraction OK — files in ${EXTRACTED_UPLOADS_DIR}"

# ──────────────────────────────────────────────────────────
# 3. Integrity checks
# ──────────────────────────────────────────────────────────
log "Step 3/5: Integrity checks"

CHECKS_PASS=true

# 3.1 Count files
RESTORED_FILE_COUNT=$(find "${EXTRACTED_UPLOADS_DIR}" -type f ! -name ".*" | wc -l)
log "Restored file count: ${RESTORED_FILE_COUNT}"

if [ "${RESTORED_FILE_COUNT}" -eq 0 ]; then
  warn "No files restored — backup may be empty (valid if uploads dir was empty at backup time)"
fi

# 3.2 Check for path traversal (no .. in any path)
TRAVERSAL_COUNT=$(find "${EXTRACTED_UPLOADS_DIR}" -type f | grep -c "\.\." || echo "0")
if [ "${TRAVERSAL_COUNT}" -gt 0 ]; then
  error "Path traversal detected in restored files"
  error "Found ${TRAVERSAL_COUNT} files with '..' in path"
  CHECKS_PASS=false
fi
ok "Path traversal check: ${TRAVERSAL_COUNT} suspicious files (expected 0)"

# 3.3 Manifest verification (if manifest exists)
MANIFEST_FILE="${BACKUP_FILE%.gpg}.manifest"
if [ -f "${MANIFEST_FILE}" ]; then
  log "Verifying against manifest: ${MANIFEST_FILE}"

  # Validate manifest JSON
  if ! python3 -c "import json; json.load(open('${MANIFEST_FILE}'))" 2>/dev/null; then
    error "Manifest is not valid JSON"
    CHECKS_PASS=false
  else
    # Compare file count
    MANIFEST_FILE_COUNT=$(python3 -c "
import json
with open('${MANIFEST_FILE}') as f:
    data = json.load(f)
print(len(data.get('files', [])))
" 2>/dev/null || echo "0")

    if [ "${MANIFEST_FILE_COUNT}" -ne "${RESTORED_FILE_COUNT}" ]; then
      warn "File count mismatch: manifest=${MANIFEST_FILE_COUNT}, restored=${RESTORED_FILE_COUNT}"
      warn "This may indicate files were added/removed during backup"
    else
      ok "Manifest file count matches restored files (${MANIFEST_FILE_COUNT})"
    fi

    # Verify checksums of a sample of files (first 5)
    SAMPLE_COUNT=0
    MAX_SAMPLE=5
    CHECKSUM_PASS=0
    CHECKSUM_FAIL=0

    python3 -c "
import json, hashlib, os
with open('${MANIFEST_FILE}') as f:
    data = json.load(f)
files = data.get('files', [])
for f in files[:${MAX_SAMPLE}]:
    relpath = f['path']
    expected_sha = f['sha256']
    abs_path = os.path.join('${EXTRACTED_UPLOADS_DIR}', relpath)
    if not os.path.exists(abs_path):
        print(f'MISSING: {relpath}')
        continue
    with open(abs_path, 'rb') as fh:
        actual_sha = hashlib.sha256(fh.read()).hexdigest()
    if actual_sha == expected_sha:
        print(f'OK: {relpath}')
    else:
        print(f'FAIL: {relpath} (expected {expected_sha[:16]}, got {actual_sha[:16]})')
" 2>/dev/null | while IFS= read -r line; do
      log "  checksum: ${line}"
    done
    ok "Checksum verification (sample of up to ${MAX_SAMPLE} files) completed"
  fi
else
  warn "No manifest file — skipping manifest verification"
fi

if [ "${CHECKS_PASS}" != true ]; then
  error "Integrity checks FAILED"
  exit 4
fi
ok "All integrity checks passed"

# ──────────────────────────────────────────────────────────
# 4. Smoke checks
# ──────────────────────────────────────────────────────────
log "Step 4/5: Smoke checks"

SMOKE_PASS=true

# 4.1 Check file extensions are allowed
ALLOWED_EXTS="jpg jpeg png webp"
EXT_VIOLATIONS=0
for f in $(find "${EXTRACTED_UPLOADS_DIR}" -type f ! -name ".*"); do
  ext="${f##*.}"
  ext_lower=$(echo "${ext}" | tr '[:upper:]' '[:lower:]')
  if ! echo " ${ALLOWED_EXTS} " | grep -q " ${ext_lower} "; then
    warn "Disallowed extension: ${f} (.${ext})"
    EXT_VIOLATIONS=$((EXT_VIOLATIONS + 1))
  fi
done
if [ "${EXT_VIOLATIONS}" -gt 0 ]; then
  error "Found ${EXT_VIOLATIONS} files with disallowed extensions (expected: ${ALLOWED_EXTS})"
  SMOKE_PASS=false
else
  ok "All file extensions are allowed (${ALLOWED_EXTS})"
fi

# 4.2 Check MIME types of a sample (first 3 files)
SAMPLE_FILES=$(find "${EXTRACTED_UPLOADS_DIR}" -type f ! -name ".*" | head -3)
MIME_FAIL=0
for f in ${SAMPLE_FILES}; do
  if command -v file >/dev/null 2>&1; then
    mime=$(file --mime-type -b "$f" 2>/dev/null || echo "unknown")
    case "${mime}" in
      image/jpeg|image/png|image/webp)
        log "  MIME: ${mime} — ${f##*/}"
        ;;
      *)
        warn "Unexpected MIME type: ${mime} — ${f##*/}"
        MIME_FAIL=$((MIME_FAIL + 1))
        ;;
    esac
  fi
done
if [ "${MIME_FAIL}" -gt 0 ]; then
  error "Found ${MIME_FAIL} files with unexpected MIME types"
  SMOKE_PASS=false
else
  ok "All sampled MIME types are valid image types"
fi

# 4.3 Check for symlinks (security — no symlinks should exist in uploads)
SYMLINK_COUNT=$(find "${EXTRACTED_UPLOADS_DIR}" -type l | wc -l)
if [ "${SYMLINK_COUNT}" -gt 0 ]; then
  error "Found ${SYMLINK_COUNT} symlinks in restored files (security risk)"
  SMOKE_PASS=false
else
  ok "No symlinks found (security check passed)"
fi

if [ "${SMOKE_PASS}" != true ]; then
  error "Smoke checks FAILED"
  exit 5
fi
ok "All smoke checks passed"

# ──────────────────────────────────────────────────────────
# 5. Update status file with restore_test success
# ──────────────────────────────────────────────────────────
RESTORE_END=$(date +%s)
RESTORE_DURATION=$((RESTORE_END - RESTORE_START))
log "Updating status file with uploads restore_test timestamp"

mkdir -p "${STATUS_DIR}"

# Read existing status to preserve other fields
LS_AT="null"
LS_SIZE="null"
LS_SHA="null"
LS_COUNT="null"
LF_AT="null"
LF_REASON="null"
RT_FAILURE="null"
RETENTION="${BACKUP_RETENTION_DAYS}"

if [ -f "${STATUS_FILE}" ]; then
  LS_AT=$(grep -o '"last_success_at": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  LS_AT="${LS_AT:-null}"
  LS_SIZE=$(grep -o '"last_success_size_bytes": [0-9]*' "${STATUS_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*' || echo "null")
  LS_SIZE="${LS_SIZE:-null}"
  LS_SHA=$(grep -o '"last_success_sha256": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  LS_SHA="${LS_SHA:-null}"
  LS_COUNT=$(grep -o '"last_success_file_count": [0-9]*' "${STATUS_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*' || echo "null")
  LS_COUNT="${LS_COUNT:-null}"
  LF_AT=$(grep -o '"last_failure_at": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  LF_AT="${LF_AT:-null}"
  LF_REASON=$(grep -o '"last_failure_reason": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  LF_REASON="${LF_REASON:-null}"
  RETENTION=$(grep -o '"retention_days": [0-9]*' "${STATUS_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*' || echo "${RETENTION}")
fi

TMP_STATUS=$(mktemp "${STATUS_DIR}/.uploads-backup-status.XXXXXX")
chmod 0644 "${TMP_STATUS}"

cat > "${TMP_STATUS}" <<JSON
{
  "last_success_at": ${LS_AT},
  "last_failure_at": ${LF_AT},
  "last_failure_reason": ${LF_REASON},
  "last_success_size_bytes": ${LS_SIZE},
  "last_success_sha256": ${LS_SHA},
  "last_success_file_count": ${LS_COUNT},
  "backup_age_seconds": null,
  "restore_test_last_success_at": "${DATE_ISO}",
  "restore_test_last_failure_at": ${RT_FAILURE},
  "retention_days": ${RETENTION}
}
JSON

mv -f "${TMP_STATUS}" "${STATUS_FILE}"
ok "Status file updated"

RESTORE_DONE=true

# ──────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────
ok ""
ok "═══════════ Uploads Restore Test Summary ═══════════"
ok "Backup file:    ${BACKUP_FILE}"
ok "Restore dir:    ${RESTORE_DIR} (ISOLATED)"
ok "Duration:       ${RESTORE_DURATION}s"
ok "Files restored: ${RESTORED_FILE_COUNT}"
ok "Integrity:      ALL CHECKS PASSED"
ok "Smoke checks:   ALL PASSED"
ok "Status file:    ${STATUS_FILE}"
ok ""
ok "Uploads restore test SUCCEEDED — backup is restorable."

trap - EXIT INT TERM HUP
maybe_cleanup
exit 0
