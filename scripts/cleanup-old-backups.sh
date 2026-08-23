#!/bin/bash
# =============================================================================
# scripts/cleanup-old-backups.sh — Retention Policy Enforcement (local only)
# =============================================================================
# این اسکریپت بکاپ‌های قدیمی‌تر از `BACKUP_RETENTION_DAYS` را حذف می‌کند.
# هم فایلِ `.gpg` و هم فایلِ `.sha256` متناظرش.
#
# این اسکریپت idempotent است — اگر فایلی برایِ حذف نباشد، با exit 0 خارج می‌شود.
#
# ⚠️  این اسکریپت فقط بکاپ‌های LOCAL را حذف می‌کند. برایِ بکاپ‌های off-site،
#     باید به‌صورتِ جداگانه روی storage هدف اجرا شود (مثلاً با SSH).
#     این مورد در `docs/BACKUP_POLICY.md` بخشِ ۵ توضیح داده شده.
#
# Usage:
#   bash scripts/cleanup-old-backups.sh
#
# Env:
#   BACKUP_RETENTION_DAYS  (default: 30, min: 7)
#
# Exit codes:
#   0 — موفق (یا هیچ فایلی برایِ حذف نبود)
#   1 — خطایِ پیش‌نیاز
# =============================================================================

set -euo pipefail

# Concurrency guard — flock prevents cleanup from racing with backup-db.sh
# (cleanup might delete a backup that backup-db.sh is in the middle of writing)
LOCK_FILE="${CLEANUP_LOCK_FILE:-/var/lock/tile-saas-cleanup-backups.lock}"
LOCK_DIR=$(dirname "${LOCK_FILE}")
if [ ! -d "${LOCK_DIR}" ]; then
  if [ "${LOCK_FILE}" = "/var/lock/tile-saas-cleanup-backups.lock" ]; then
    LOCK_FILE="/tmp/tile-saas-cleanup-backups.lock"
  fi
fi
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  echo "ERROR: another cleanup-old-backups.sh is already running (lock: ${LOCK_FILE})" >&2
  exit 1
fi

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

# Load .env (selectively)
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  ( source "${PROJECT_ROOT}/.env" 2>/dev/null && \
    for var in BACKUP_RETENTION_DAYS BACKUP_OFFSITE_TARGET BACKUP_OFFSITE_SSH_KEY; do
      if [ -n "${!var:-}" ]; then echo "${var}=${!var}"; fi
    done ) | while IFS='=' read -r k v; do export "${k}=${v}"; done
  set +a
fi

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]] || [ "${RETENTION_DAYS}" -lt 7 ]; then
  error "BACKUP_RETENTION_DAYS must be an integer ≥ 7 (got: '${RETENTION_DAYS}')"
  error "Refusing to run with such an aggressive retention — risk of data loss"
  exit 1
fi

if [ ! -d "${BACKUP_DIR}" ]; then
  warn "Backup directory does not exist: ${BACKUP_DIR}"
  warn "Nothing to clean up."
  exit 0
fi

log "Cleaning up LOCAL backups older than ${RETENTION_DAYS} days"
log "Backup directory: ${BACKUP_DIR}"
if [ -n "${BACKUP_OFFSITE_TARGET:-}" ]; then
  warn "Off-site backups at '${BACKUP_OFFSITE_TARGET}' are NOT cleaned by this script."
  warn "Run cleanup on the off-site host separately (see docs/BACKUP_POLICY.md section 5)."
fi

# Find and delete old backup files (.gpg and .sha256 pairs)
DELETED_COUNT=0
DELETED_SIZE=0

# Use find with -mtime for older-than-N-days (24h-based)
# Find .gpg files first, then their .sha256 siblings
while IFS= read -r -d '' backup_file; do
  file_size=$(stat -c%s "$backup_file" 2>/dev/null || stat -f%z "$backup_file")
  file_date=$(stat -c%y "$backup_file" 2>/dev/null || stat -f%Sm "$backup_file")

  log "Deleting: $(basename "$backup_file") (size: ${file_size}, modified: ${file_date})"

  # Delete the .gpg file
  rm -f "$backup_file"

  # Delete the .sha256 file (if exists)
  rm -f "${backup_file}.sha256" 2>/dev/null || true

  DELETED_COUNT=$((DELETED_COUNT + 1))
  DELETED_SIZE=$((DELETED_SIZE + file_size))
done < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "*.gpg" -mtime "+${RETENTION_DAYS}" -print0)

# Human-readable size
hr_size() {
  local bytes=$1
  if [ "$bytes" -ge 1073741824 ]; then
    echo "$(echo "scale=2; ${bytes} / 1073741824" | bc) GB"
  elif [ "$bytes" -ge 1048576 ]; then
    echo "$(echo "scale=2; ${bytes} / 1048576" | bc) MB"
  elif [ "$bytes" -ge 1024 ]; then
    echo "$(echo "scale=2; ${bytes} / 1024" | bc) KB"
  else
    echo "${bytes} bytes"
  fi
}

# List remaining backups
REMAINING=$(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "*.gpg" | wc -l)
REMAINING_SIZE=$(du -sb "${BACKUP_DIR}" 2>/dev/null | awk '{print $1}' || echo 0)

ok ""
ok "Cleanup complete"
ok "Deleted: ${DELETED_COUNT} backup(s) ($(hr_size "${DELETED_SIZE}"))"
ok "Remaining: ${REMAINING} backup(s) ($(hr_size "${REMAINING_SIZE}"))"
ok "Retention policy: ${RETENTION_DAYS} days"

exit 0
