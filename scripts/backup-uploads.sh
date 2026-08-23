#!/bin/bash
# =============================================================================
# scripts/backup-uploads.sh — Backup private/uploads/ with tar + zstd + GPG
# =============================================================================
# این اسکریپت فایل‌های private/uploads/ را به‌صورتِ رمزنگاری‌شده بکاپ می‌گیرد.
# این AUD-009 را رفع می‌کند — backup دیتابیس به‌تنهایی Disaster Recovery کامل
# نیست چون فایل‌های آپلودشده روی volume جدا هستند.
#
# مراحل:
#   ۱. بررسی وجود private/uploads/
#   ۲. ایجاد tar archive از همه‌ی فایل‌ها
#   ۳. فشرده‌سازی با zstd
#   ۴. رمزنگاری با GPG (symmetric AES-256، مانند backup-db.sh)
#   ۵. محاسبه‌ی SHA-256 checksum
#   ۶. ایجاد manifest (لیستِ فایل‌ها با size و checksum هرکدام)
#   ۷. Verify: decrypt + tar --list
#   ۸. آپلود به off-site (اگر BACKUP_OFFSITE_TARGET ست شده باشد)
#   ۹. نوشتن status file برای /api/metrics
#
# Security:
#   - Passphrase هرگز در args نیست (stdin از طریقِ --passphrase-fd 0)
#   - Passphrase هرگز در لاگ چاپ نمی‌شود
#   - tar archive و فشرده‌شده‌ی رمزنگاری‌نشده بعد از encryption پاک می‌شوند
#   - فایل‌های .gpg و .sha256 و .manifest با permission 0600 ساخته می‌شوند
#
# Usage:
#   bash scripts/backup-uploads.sh
#   COMPOSE_FILE=docker-compose.staging.yml bash scripts/backup-uploads.sh
#
# Exit codes:
#   0 — موفق
#   1 — خطایِ پیش‌نیاز
#   2 — خطایِ tar
#   3 — خطایِ compression
#   4 — خطایِ encryption یا verify
#   5 — خطایِ off-site upload
# =============================================================================

set -euo pipefail

# ──────────────────────────────────────────────────────────
# Anti-leak defenses (same as backup-db.sh)
# ──────────────────────────────────────────────────────────
if [[ "${-}" == *x* ]]; then
  echo "ERROR: this script must not run with 'set -x' (passphrase leak risk)" >&2
  exit 1
fi
set +o history 2>/dev/null || true

# ──────────────────────────────────────────────────────────
# Concurrency guard — flock
# ──────────────────────────────────────────────────────────
LOCK_FILE="${UPLOADS_LOCK_FILE:-/var/lock/tile-saas-backup-uploads.lock}"
LOCK_DIR=$(dirname "${LOCK_FILE}")
if [ ! -d "${LOCK_DIR}" ]; then
  if [ "${LOCK_FILE}" = "/var/lock/tile-saas-backup-uploads.lock" ]; then
    LOCK_FILE="/tmp/tile-saas-backup-uploads.lock"
  fi
fi
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  echo "ERROR: another backup-uploads.sh is already running (lock: ${LOCK_FILE})" >&2
  exit 1
fi

# Test hook (same pattern as backup-db.sh)
BACKUP_TEST_MODE="${BACKUP_TEST_MODE:-0}"
if [ "${BACKUP_TEST_MODE}" = "1" ] && [ -n "${BACKUP_TEST_HOLD_SECONDS:-}" ]; then
  if ! [[ "${BACKUP_TEST_HOLD_SECONDS}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "ERROR: BACKUP_TEST_HOLD_SECONDS must be a non-negative number" >&2
    exit 1
  fi
  local_hold_int="${BACKUP_TEST_HOLD_SECONDS%.*}"
  if [ "${local_hold_int}" -gt 300 ] 2>/dev/null; then
    echo "ERROR: BACKUP_TEST_HOLD_SECONDS exceeds 300 second cap" >&2
    exit 1
  fi
  echo "TEST MODE: holding lock for ${BACKUP_TEST_HOLD_SECONDS} seconds" >&2
  sleep "${BACKUP_TEST_HOLD_SECONDS}"
fi

# ──────────────────────────────────────────────────────────
# Color codes
# ──────────────────────────────────────────────────────────
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; NC=''
fi

log()   { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${BLUE}INFO${NC}  $*"; }
warn()  { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${YELLOW}WARN${NC}  $*"; }
error() { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${RED}ERROR${NC} $*" >&2; }
ok()    { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ${GREEN}OK${NC}    $*"; }

# ──────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups/uploads"
STATUS_DIR="${PROJECT_ROOT}/backups/status"
STATUS_FILE="${STATUS_DIR}/uploads-backup-status.json"

# Load .env (selectively)
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  ( source "${PROJECT_ROOT}/.env" 2>/dev/null && \
    for var in BACKUP_GPG_PASSPHRASE BACKUP_OFFSITE_TARGET BACKUP_OFFSITE_SSH_KEY \
               BACKUP_OFFSITE_METHOD BACKUP_RETENTION_DAYS COMPOSE_FILE; do
      if [ -n "${!var:-}" ]; then echo "${var}=${!var}"; fi
    done ) | while IFS='=' read -r k v; do export "${k}=${v}"; done
  set +a
fi

# Required env vars
BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required — see docs/BACKUP_POLICY.md}"

# Optional env vars
BACKUP_OFFSITE_TARGET="${BACKUP_OFFSITE_TARGET:-}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

# Validate retention
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
if ! [[ "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]] || [ "${BACKUP_RETENTION_DAYS}" -lt 7 ]; then
  echo "ERROR: BACKUP_RETENTION_DAYS must be an integer ≥ 7" >&2
  exit 1
fi

# Timestamp
STAMP="$(date -u +%Y-%m-%d_%H%M)"
DATE_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BACKUP_NAME="uploads_${STAMP}"
BACKUP_FILE_TAR="${BACKUP_DIR}/${BACKUP_NAME}.tar"
BACKUP_FILE_ZST="${BACKUP_DIR}/${BACKUP_NAME}.tar.zst"
BACKUP_FILE_GPG="${BACKUP_DIR}/${BACKUP_NAME}.tar.zst.gpg"
BACKUP_FILE_SHA256="${BACKUP_FILE_GPG}.sha256"
BACKUP_FILE_MANIFEST="${BACKUP_DIR}/${BACKUP_NAME}.manifest"

# Temporary directory for intermediate files
TMP_DIR=$(mktemp -d)
chmod 700 "${TMP_DIR}"

# ──────────────────────────────────────────────────────────
# Read previous status file (stale prevention — same as backup-db.sh)
# ──────────────────────────────────────────────────────────
PREV_LAST_SUCCESS_AT="null"
PREV_LAST_SUCCESS_SIZE="null"
PREV_LAST_SUCCESS_SHA256="null"
PREV_LAST_SUCCESS_FILE_COUNT="null"
PREV_RESTORE_SUCCESS_AT="null"
PREV_RESTORE_FAILURE_AT="null"

if [ -f "${STATUS_FILE}" ]; then
  PREV_LAST_SUCCESS_AT=$(grep -o '"last_success_at": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  PREV_LAST_SUCCESS_AT="${PREV_LAST_SUCCESS_AT:-null}"
  PREV_LAST_SUCCESS_SIZE=$(grep -o '"last_success_size_bytes": [0-9]*' "${STATUS_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*' || echo "null")
  PREV_LAST_SUCCESS_SIZE="${PREV_LAST_SUCCESS_SIZE:-null}"
  PREV_LAST_SUCCESS_SHA256=$(grep -o '"last_success_sha256": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  PREV_LAST_SUCCESS_SHA256="${PREV_LAST_SUCCESS_SHA256:-null}"
  PREV_LAST_SUCCESS_FILE_COUNT=$(grep -o '"last_success_file_count": [0-9]*' "${STATUS_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*' || echo "null")
  PREV_LAST_SUCCESS_FILE_COUNT="${PREV_LAST_SUCCESS_FILE_COUNT:-null}"
  PREV_RESTORE_SUCCESS_AT=$(grep -o '"restore_test_last_success_at": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  PREV_RESTORE_SUCCESS_AT="${PREV_RESTORE_SUCCESS_AT:-null}"
fi

LAST_SUCCESS_AT="${PREV_LAST_SUCCESS_AT}"
LAST_SUCCESS_SIZE="${PREV_LAST_SUCCESS_SIZE}"
LAST_SUCCESS_SHA256="${PREV_LAST_SUCCESS_SHA256}"
LAST_SUCCESS_FILE_COUNT="${PREV_LAST_SUCCESS_FILE_COUNT}"
LAST_FAILURE_AT="null"
LAST_FAILURE_REASON="null"
FAILED=false
FAILURE_REASON=""

# ──────────────────────────────────────────────────────────
# Status file writers (atomic write via temp + rename)
# ──────────────────────────────────────────────────────────
write_status_file() {
  local ls_at="${1:-null}"
  local lf_at="${2:-null}"
  local lf_reason="${3:-null}"
  local ls_size="${4:-null}"
  local ls_sha="${5:-null}"
  local ls_count="${6:-null}"
  local rt_success="${7:-null}"
  local rt_failure="${8:-null}"

  mkdir -p "${STATUS_DIR}"
  local tmp_status
  tmp_status=$(mktemp "${STATUS_DIR}/.uploads-backup-status.XXXXXX")

  cat > "${tmp_status}" <<JSON
{
  "last_success_at": ${ls_at},
  "last_failure_at": ${lf_at},
  "last_failure_reason": ${lf_reason},
  "last_success_size_bytes": ${ls_size},
  "last_success_sha256": ${ls_sha},
  "last_success_file_count": ${ls_count},
  "backup_age_seconds": null,
  "restore_test_last_success_at": ${rt_success},
  "restore_test_last_failure_at": ${rt_failure},
  "retention_days": ${BACKUP_RETENTION_DAYS}
}
JSON

  chmod 0644 "${tmp_status}"
  mv -f "${tmp_status}" "${STATUS_FILE}"
}

write_status_failure() {
  local reason="${1:-unknown}"
  local failure_ts
  failure_ts="\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
  write_status_file \
    "${LAST_SUCCESS_AT}" \
    "${failure_ts}" \
    "\"${reason}\"" \
    "${LAST_SUCCESS_SIZE}" \
    "${LAST_SUCCESS_SHA256}" \
    "${LAST_SUCCESS_FILE_COUNT}" \
    "${PREV_RESTORE_SUCCESS_AT}" \
    "${PREV_RESTORE_FAILURE_AT}"
}

write_status_success() {
  local success_ts="\"${DATE_ISO}\""
  write_status_file \
    "${success_ts}" \
    "null" \
    "null" \
    "${LAST_SUCCESS_SIZE}" \
    "\"${LAST_SUCCESS_SHA256}\"" \
    "${LAST_SUCCESS_FILE_COUNT}" \
    "${PREV_RESTORE_SUCCESS_AT}" \
    "${PREV_RESTORE_FAILURE_AT}"
}

# ──────────────────────────────────────────────────────────
# Cleanup on exit / signal (with double-cleanup guard)
# ──────────────────────────────────────────────────────────
CLEANUP_DONE=0

cleanup() {
  if [ "${CLEANUP_DONE}" -eq 1 ]; then
    return 0
  fi
  CLEANUP_DONE=1

  # Clean up intermediate files (tar and compressed-but-not-encrypted)
  rm -f "${BACKUP_FILE_TAR}" 2>/dev/null || true
  rm -f "${BACKUP_FILE_ZST}" 2>/dev/null || true

  if [ -n "${TMP_DIR:-}" ] && [ -d "${TMP_DIR}" ]; then
    rm -rf "${TMP_DIR}" 2>/dev/null || true
  fi

  if [ "${FAILED}" = true ]; then
    error "Uploads backup failed: ${FAILURE_REASON:-unknown}"
    write_status_failure "${FAILURE_REASON:-unknown}"
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
# 0. Pre-flight checks
# ──────────────────────────────────────────────────────────
log "Uploads backup starting — ${DATE_ISO}"
log "Project root: ${PROJECT_ROOT}"
log "Backup target: ${BACKUP_FILE_GPG}"

# Required commands
for cmd in tar zstd gpg docker; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    error "Required command not found: $cmd"
    FAILED=true
    FAILURE_REASON="missing_command_${cmd}"
    exit 1
  fi
done
ok "All required commands available: tar, zstd, gpg, docker"

# Docker Compose must be running with postgres service
if ! docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" ps postgres 2>/dev/null | grep -q "postgres"; then
  error "PostgreSQL container is not running"
  FAILED=true
  FAILURE_REASON="postgres_container_not_running"
  exit 1
fi
ok "PostgreSQL container is running"

# Find the web container (uploads volume is mounted there)
WEB_CONTAINER=$(docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" ps -q web 2>/dev/null | head -1)
if [ -z "${WEB_CONTAINER}" ]; then
  error "Web container is not running — uploads volume is mounted there"
  FAILED=true
  FAILURE_REASON="web_container_not_running"
  exit 1
fi
ok "Web container is running"

# Verify uploads directory exists inside the container
UPLOADS_DIR_IN_CONTAINER="/app/web/private/uploads"
if ! docker exec "${WEB_CONTAINER}" test -d "${UPLOADS_DIR_IN_CONTAINER}" 2>/dev/null; then
  error "Uploads directory does not exist in container: ${UPLOADS_DIR_IN_CONTAINER}"
  FAILED=true
  FAILURE_REASON="uploads_dir_not_found"
  exit 1
fi
ok "Uploads directory exists: ${UPLOADS_DIR_IN_CONTAINER}"

# Count files in uploads directory
FILE_COUNT=$(docker exec "${WEB_CONTAINER}" find "${UPLOADS_DIR_IN_CONTAINER}" -type f ! -name ".*" 2>/dev/null | wc -l)
log "Files in uploads directory: ${FILE_COUNT}"

if [ "${FILE_COUNT}" -eq 0 ]; then
  warn "Uploads directory is empty — creating empty backup (still valid)"
fi

mkdir -p "${BACKUP_DIR}" "${STATUS_DIR}"

# ──────────────────────────────────────────────────────────
# 1. Create tar archive (inside container, stream to host)
# ──────────────────────────────────────────────────────────
log "Step 1/7: Create tar archive"

# Use tar inside the container and stream to host
# --numeric-owner: avoid user/group name resolution issues
# --sort=name: deterministic order for reproducible archives
# We cd to the parent of uploads/ so tar stores relative paths (uploads/...)
docker exec "${WEB_CONTAINER}" tar \
  --create \
  --numeric-owner \
  --sort=name \
  --directory="$(dirname "${UPLOADS_DIR_IN_CONTAINER}")" \
  "$(basename "${UPLOADS_DIR_IN_CONTAINER}")" \
  > "${BACKUP_FILE_TAR}" 2>"${TMP_DIR}/tar.log"

TAR_EXIT=$?
if [ ${TAR_EXIT} -ne 0 ] || [ ! -s "${BACKUP_FILE_TAR}" ]; then
  error "tar failed (exit ${TAR_EXIT})"
  cat "${TMP_DIR}/tar.log" >&2 || true
  FAILED=true
  FAILURE_REASON="tar_failed"
  exit 2
fi
TAR_SIZE=$(stat -c%s "${BACKUP_FILE_TAR}" 2>/dev/null || stat -f%z "${BACKUP_FILE_TAR}")
ok "tar OK — size: ${TAR_SIZE} bytes, ${FILE_COUNT} files"

# ──────────────────────────────────────────────────────────
# 2. Compress with zstd
# ──────────────────────────────────────────────────────────
log "Step 2/7: zstd compression"
zstd -q -19 -f -o "${BACKUP_FILE_ZST}" "${BACKUP_FILE_TAR}"
ZST_SIZE=$(stat -c%s "${BACKUP_FILE_ZST}" 2>/dev/null || stat -f%z "${BACKUP_FILE_ZST}")
if [ "${ZST_SIZE}" -lt 100 ] && [ "${FILE_COUNT}" -gt 0 ]; then
  error "zstd compression produced an empty file"
  FAILED=true
  FAILURE_REASON="zstd_failed"
  rm -f "${BACKUP_FILE_TAR}" "${BACKUP_FILE_ZST}"
  exit 3
fi
ok "zstd OK — compressed size: ${ZST_SIZE} bytes"

# Securely delete the raw tar archive (it contains unencrypted user files)
rm -f "${BACKUP_FILE_TAR}"

# ──────────────────────────────────────────────────────────
# 3. Encrypt with GPG (same flags as backup-db.sh)
# ──────────────────────────────────────────────────────────
log "Step 3/7: GPG encryption (symmetric AES-256)"

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
  "${BACKUP_FILE_ZST}" \
  2>"${TMP_DIR}/gpg_encrypt.log"

GPG_EXIT=$?
if [ ${GPG_EXIT} -ne 0 ] || [ ! -s "${BACKUP_FILE_GPG}" ]; then
  error "GPG encryption failed (exit ${GPG_EXIT})"
  cat "${TMP_DIR}/gpg_encrypt.log" >&2 || true
  FAILED=true
  FAILURE_REASON="gpg_encrypt_failed"
  rm -f "${BACKUP_FILE_ZST}" "${BACKUP_FILE_GPG}"
  exit 4
fi
GPG_SIZE=$(stat -c%s "${BACKUP_FILE_GPG}" 2>/dev/null || stat -f%z "${BACKUP_FILE_GPG}")
chmod 600 "${BACKUP_FILE_GPG}"
ok "GPG OK — encrypted size: ${GPG_SIZE} bytes"

# Securely delete the compressed-only file
rm -f "${BACKUP_FILE_ZST}"

# ──────────────────────────────────────────────────────────
# 4. SHA-256 checksum
# ──────────────────────────────────────────────────────────
log "Step 4/7: SHA-256 checksum"
SHA256=$(sha256sum "${BACKUP_FILE_GPG}" | awk '{print $1}')
echo "${SHA256}  ${BACKUP_FILE_GPG}" > "${BACKUP_FILE_SHA256}"
chmod 600 "${BACKUP_FILE_SHA256}"
ok "SHA-256: ${SHA256}"

# ──────────────────────────────────────────────────────────
# 5. Manifest (list of files with individual checksums)
# ──────────────────────────────────────────────────────────
log "Step 5/7: Generate manifest"

# Manifest format: relative_path\tsize\tsha256\tmtime
# We compute SHA-256 for each file inside the container (so we don't need to
# copy files to host). The manifest is stored as JSON for easy parsing.
MANIFEST_TMP="${TMP_DIR}/manifest.json"

# Generate manifest inside the container
docker exec "${WEB_CONTAINER}" bash -c '
  UPLOADS_DIR="'"${UPLOADS_DIR_IN_CONTAINER}"'"
  echo "{"
  echo "  \"backup_name\": \"'"${BACKUP_NAME}"'\","
  echo "  \"created_at\": \"'"${DATE_ISO}"'\","
  echo "  \"file_count\": '"${FILE_COUNT}"',"
  echo "  \"files\": ["
  FIRST=true
  find "${UPLOADS_DIR}" -type f ! -name ".*" -print0 | sort -z | while IFS= read -r -d "" filepath; do
    relpath="${filepath#${UPLOADS_DIR}/}"
    size=$(stat -c%s "${filepath}" 2>/dev/null || echo "0")
    sha256=$(sha256sum "${filepath}" 2>/dev/null | awk "{print \$1}")
    mtime=$(stat -c%Y "${filepath}" 2>/dev/null || echo "0")
    if [ "${FIRST}" = true ]; then
      FIRST=false
    else
      echo ","
    fi
    printf "    {\"path\": \"%s\", \"size\": %s, \"sha256\": \"%s\", \"mtime\": %s}" "${relpath}" "${size}" "${sha256}" "${mtime}"
  done
  echo ""
  echo "  ]"
  echo "}"
' > "${MANIFEST_TMP}" 2>"${TMP_DIR}/manifest.log"

if [ ! -s "${MANIFEST_TMP}" ]; then
  error "Manifest generation failed"
  cat "${TMP_DIR}/manifest.log" >&2 || true
  # Non-fatal — manifest is optional, but warn
  warn "Manifest is empty (may be OK if uploads directory is empty)"
  echo '{"backup_name": "'"${BACKUP_NAME}"'", "created_at": "'"${DATE_ISO}"'", "file_count": 0, "files": []}' > "${MANIFEST_TMP}"
fi

# Validate manifest is valid JSON
if ! python3 -c "import json; json.load(open('${MANIFEST_TMP}'))" 2>/dev/null; then
  error "Manifest is not valid JSON"
  cat "${MANIFEST_TMP}" >&2 || true
  FAILED=true
  FAILURE_REASON="manifest_invalid_json"
  exit 4
fi

cp "${MANIFEST_TMP}" "${BACKUP_FILE_MANIFEST}"
chmod 600 "${BACKUP_FILE_MANIFEST}"
ok "Manifest generated: ${FILE_COUNT} files"

# ──────────────────────────────────────────────────────────
# 6. Decrypt verification (sanity check)
# ──────────────────────────────────────────────────────────
log "Step 6/7: Decrypt sanity check"

if ! echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt "${BACKUP_FILE_GPG}" 2>"${TMP_DIR}/gpg_decrypt.log" \
  | zstd -d 2>"${TMP_DIR}/zstd_decompress.log" \
  > "${TMP_DIR}/verify.tar"; then
  error "GPG decrypt or zstd decompress failed"
  cat "${TMP_DIR}/gpg_decrypt.log" >&2 || true
  cat "${TMP_DIR}/zstd_decompress.log" >&2 || true
  FAILED=true
  FAILURE_REASON="decrypt_verify_failed"
  exit 4
fi

# Verify it's a valid tar archive
if ! tar -tf "${TMP_DIR}/verify.tar" >/dev/null 2>&1; then
  error "Decrypted file is not a valid tar archive"
  FAILED=true
  FAILURE_REASON="invalid_tar_format"
  exit 4
fi

# Count files in the tar — should match FILE_COUNT
TAR_FILE_COUNT=$(tar -tf "${TMP_DIR}/verify.tar" 2>/dev/null | grep -c "^uploads/[^/]*$" || echo "0")
if [ "${TAR_FILE_COUNT}" -ne "${FILE_COUNT}" ]; then
  warn "File count mismatch: disk=${FILE_COUNT}, tar=${TAR_FILE_COUNT}"
  warn "This may be OK if files were added/removed during backup"
fi

rm -f "${TMP_DIR}/verify.tar"
ok "Decrypt + tar verification OK"

# ──────────────────────────────────────────────────────────
# 7. Off-site copy
# ──────────────────────────────────────────────────────────
log "Step 7/7: Off-site copy"

OFFSITE_OK="false"
if [ -z "${BACKUP_OFFSITE_TARGET}" ]; then
  warn "BACKUP_OFFSITE_TARGET not set — skipping off-site copy"
  OFFSITE_OK="skipped"
elif [ "${BACKUP_OFFSITE_METHOD:-rsync}" = "rsync" ]; then
  local_rsync_args=(rsync -avz --timeout=300)
  if [ -n "${BACKUP_OFFSITE_SSH_KEY:-}" ]; then
    local_rsync_args+=(
      -e "ssh -i ${BACKUP_OFFSITE_SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
    )
  fi

  log "rsync to ${BACKUP_OFFSITE_TARGET}/"

  if "${local_rsync_args[@]}" "${BACKUP_FILE_GPG}" "${BACKUP_OFFSITE_TARGET}/" \
      > "${TMP_DIR}/rsync.log" 2>&1; then
    if ! "${local_rsync_args[@]}" "${BACKUP_FILE_SHA256}" "${BACKUP_OFFSITE_TARGET}/" \
        >> "${TMP_DIR}/rsync.log" 2>&1; then
      warn "Could not sync .sha256 file (non-fatal)"
    fi
    if ! "${local_rsync_args[@]}" "${BACKUP_FILE_MANIFEST}" "${BACKUP_OFFSITE_TARGET}/" \
        >> "${TMP_DIR}/rsync.log" 2>&1; then
      warn "Could not sync .manifest file (non-fatal)"
    fi
    ok "rsync OK"
    OFFSITE_OK="true"
  else
    error "rsync failed (exit $?)"
    cat "${TMP_DIR}/rsync.log" >&2 || true
    FAILED=true
    FAILURE_REASON="rsync_failed"
    OFFSITE_OK="false"
  fi
else
  error "Unknown BACKUP_OFFSITE_METHOD: ${BACKUP_OFFSITE_METHOD}"
  FAILED=true
  FAILURE_REASON="unknown_offsite_method"
fi

# ──────────────────────────────────────────────────────────
# Final: write status file
# ──────────────────────────────────────────────────────────
LAST_SUCCESS_AT="\"${DATE_ISO}\""
LAST_SUCCESS_SIZE="${GPG_SIZE}"
LAST_SUCCESS_SHA256="\"${SHA256}\""
LAST_SUCCESS_FILE_COUNT="${FILE_COUNT}"

if [ "${OFFSITE_OK}" = "false" ]; then
  write_status_file \
    "${LAST_SUCCESS_AT}" \
    "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"" \
    "\"offsite_copy_failed\"" \
    "${LAST_SUCCESS_SIZE}" \
    "${LAST_SUCCESS_SHA256}" \
    "${LAST_SUCCESS_FILE_COUNT}" \
    "${PREV_RESTORE_SUCCESS_AT}" \
    "${PREV_RESTORE_FAILURE_AT}"
else
  write_status_success
fi

ok "Uploads backup complete: ${BACKUP_FILE_GPG}"
ok "Size: ${GPG_SIZE} bytes | SHA-256: ${SHA256:0:16}... | Files: ${FILE_COUNT}"

if [ "${OFFSITE_OK}" = "skipped" ]; then
  warn "Off-site copy SKIPPED"
elif [ "${OFFSITE_OK}" = "true" ]; then
  ok "Off-site copy: OK"
else
  warn "Off-site copy FAILED"
fi

FAILED=false
exit 0
