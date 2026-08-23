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
#
# Pre-requisites:
#   - Docker Compose با serviceِ postgres بالا باشد
#   - gpg و zstd روی host نصب باشند
#   - rsync اگر `BACKUP_OFFSITE_TARGET` ست شده باشد
#   - متغیرهای محیطیِ لازم در `.env` یا environment ست شده باشند
#
# Security:
#   - Passphrase هرگز در args نیست (stdin از طریقِ --passphrase-fd 0)
#   - Passphrase هرگز در لاگ چاپ نمی‌شود (gpg stderr به فایلِ موقت هدایت می‌شود)
#   - فایل‌های خام و فشرده‌ی رمزنگاری‌نشده بعد از encryption پاک می‌شوند
#   - فایل‌های `.gpg` و `.sha256` با permission 0600 ساخته می‌شوند
#   - status file با permission 0644 ساخته می‌شود (فقط metadata، بدونِ secret)
#   - اگر بکاپ fail شود، status file آخرین موفقیتِ شناخته‌شده را حفظ می‌کند
#
# Usage:
#   bash scripts/backup-db.sh
#   COMPOSE_FILE=docker-compose.staging.yml bash scripts/backup-db.sh
#
# Exit codes:
#   0 — موفق
#   1 — خطایِ پیش‌نیاز (env var missing، docker not running)
#   2 — خطایِ pg_dump
#   3 — خطایِ compression
#   4 — خطایِ encryption یا decrypt verify
#   5 — خطایِ off-site upload (local backup همچنان موفق)
# =============================================================================

set -euo pipefail

# ──────────────────────────────────────────────────────────
# Anti-leak defenses
# ──────────────────────────────────────────────────────────
# اگر کسی اسکریپت را با `bash -x` اجرا کرد، passphrase در stderr چاپ می‌شد.
# این غیرفعال‌کننده‌ی دفاعی است.
if [[ "${BASH_XTRACEFD:-}" ]] || [[ "${-}" == *x* ]]; then
  echo "ERROR: this script must not run with 'set -x' (passphrase leak risk)" >&2
  exit 1
fi

# تاریخچه‌ی shell را در حینِ اجرا غیرفعال کن (defense-in-depth)
set +o history 2>/dev/null || true

# ──────────────────────────────────────────────────────────
# Concurrency guard — flock prevents two backup-db.sh runs from
# clobbering each other's output or status file
# ──────────────────────────────────────────────────────────
# سناریوی خطر: cron قبلی هنوز در حالِ اجراست (مثلاً pg_dump کند است)،
# cron بعدی شروع می‌شود. هر دو به status file می‌نویسند، هر دو فایلِ
# backup می‌سازند — race condition، احتمالاً corruption.
#
# flock با یک FD و فایل lock این را حل می‌کند:
#   - اگر lock در دسترس باشد، اجرا ادامه می‌یابد
#   - اگر در دسترس نباشد، اسکریپت fail-loud خارج می‌شود
#
# مسیرِ lock قابلِ override با BACKUP_LOCK_FILE (مثلاً برایِ تست).
LOCK_FILE="${BACKUP_LOCK_FILE:-/var/lock/tile-saas-backup-db.lock}"

# اطمینان از اینکه دایرکتوریِ lock موجود است (ممکن است /var/lock نباشد در برخی envها)
LOCK_DIR=$(dirname "${LOCK_FILE}")
if [ ! -d "${LOCK_DIR}" ]; then
  # اگر /var/lock نیست، fallback به /tmp
  if [ "${LOCK_FILE}" = "/var/lock/tile-saas-backup-db.lock" ]; then
    LOCK_FILE="/tmp/tile-saas-backup-db.lock"
  fi
fi

# FD 200 را باز کن و flock بگیر (non-blocking)
# این دستور یا موفق می‌شود (lock گرفته شد) یا fail می‌کند (lock در دستِ دیگری است)
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  echo "ERROR: another backup-db.sh is already running (lock: ${LOCK_FILE})" >&2
  echo "ERROR: if you are sure no backup is running, remove the lock file: rm ${LOCK_FILE}" >&2
  exit 1
fi
# Lock به‌صورت خودکار با exitِ process آزاد می‌شود (FD 200 بسته می‌شود)

# ──────────────────────────────────────────────────────────
# Test hook — sleep after acquiring flock, for deterministic concurrency tests.
# ──────────────────────────────────────────────────────────
# ⚠️  ONLY FOR TESTING — این hook عمداً pre-flight checks را به تأخیر می‌اندازد.
#     در production، هرگز این متغیرها را ست نکنید.
#
# فعال‌سازی: BACKUP_TEST_MODE=1 + BACKUP_TEST_HOLD_SECONDS=N
#   (هر دو لازم است — defense-in-depth در برابرِ فعال‌شدنِ تصادفی)
#
# Usage in tests:
#   BACKUP_TEST_MODE=1 BACKUP_TEST_HOLD_SECONDS=5 bash scripts/backup-db.sh &  # holds lock 5s
#   bash scripts/backup-db.sh &                                                 # should fail "already running"
#
# محدودیت‌ها:
#   - BACKUP_TEST_HOLD_SECONDS باید عددِ غیرمنفی باشد (regex: ^[0-9]+([.][0-9]+)?$)
#   - سقف: ۳۰۰ ثانیه (جلوگیری از قفل کردنِ cron یا CI برای مدتِ نامحدود)
#   - این sleep قبل ازِ pre-flight checks قرار دارد — یعنی require_command و
#     docker-compose check به تأخیر می‌افتند. این عمدی است (برایِ تستِ contention)
#     ولی برایِ production مناسب نیست.
BACKUP_TEST_MODE="${BACKUP_TEST_MODE:-0}"

if [ "${BACKUP_TEST_MODE}" = "1" ] && [ -n "${BACKUP_TEST_HOLD_SECONDS:-}" ]; then
  # Validate: must be a non-negative number (integer or decimal)
  if ! [[ "${BACKUP_TEST_HOLD_SECONDS}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "ERROR: BACKUP_TEST_HOLD_SECONDS must be a non-negative number (got: '${BACKUP_TEST_HOLD_SECONDS}')" >&2
    exit 1
  fi

  # Cap at 300 seconds (5 minutes) to prevent runaway locks
  local_hold_int="${BACKUP_TEST_HOLD_SECONDS%.*}"
  if [ "${local_hold_int}" -gt 300 ] 2>/dev/null; then
    echo "ERROR: BACKUP_TEST_HOLD_SECONDS exceeds 300 second cap (got: ${BACKUP_TEST_HOLD_SECONDS})" >&2
    echo "ERROR: this is a test-only hook; larger values risk blocking cron or CI indefinitely" >&2
    exit 1
  fi

  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] INFO  TEST MODE: holding lock for ${BACKUP_TEST_HOLD_SECONDS} seconds (BACKUP_TEST_HOLD_SECONDS)"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] INFO  TEST MODE: pre-flight checks are DELIBERATELY delayed — NOT for production" >&2
  sleep "${BACKUP_TEST_HOLD_SECONDS}"
fi

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

# Load .env if present (for local testing). ما فقطِ متغیرهای BE_*/BACKUP_*/POSTGRES_*
# را می‌خوانیم تا نشت ناخواسته پیش نیاید.
if [ -f "${PROJECT_ROOT}/.env" ]; then
  # shellcheck disable=SC1091
  set -a
  # Source را در subshell اجرا کن تا exit کد را تحت تاثیر نگذارد
  ( source "${PROJECT_ROOT}/.env" 2>/dev/null && \
    for var in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
               BACKUP_GPG_PASSPHRASE BACKUP_OFFSITE_TARGET BACKUP_OFFSITE_SSH_KEY \
               BACKUP_OFFSITE_METHOD BACKUP_RETENTION_DAYS COMPOSE_FILE; do
      if [ -n "${!var:-}" ]; then echo "${var}=${!var}"; fi
    done ) | while IFS='=' read -r k v; do export "${k}=${v}"; done
  set +a
fi

# Required env vars — fail loud
POSTGRES_USER="${POSTGRES_USER:-tile_app}"
POSTGRES_DB="${POSTGRES_DB:-tile_saas}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required — see docs/BACKUP_POLICY.md}"

# Optional env vars
BACKUP_OFFSITE_TARGET="${BACKUP_OFFSITE_TARGET:-}"
BACKUP_OFFSITE_METHOD="${BACKUP_OFFSITE_METHOD:-rsync}"
BACKUP_OFFSITE_SSH_KEY="${BACKUP_OFFSITE_SSH_KEY:-}"

# Validate BACKUP_RETENTION_DAYS is a positive integer ≥ 7
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
if ! [[ "${BACKUP_RETENTION_DAYS}" =~ ^[0-9]+$ ]] || [ "${BACKUP_RETENTION_DAYS}" -lt 7 ]; then
  echo "ERROR: BACKUP_RETENTION_DAYS must be an integer ≥ 7 (got: '${BACKUP_RETENTION_DAYS}')" >&2
  exit 1
fi

# Validate BACKUP_OFFSITE_METHOD
case "${BACKUP_OFFSITE_METHOD}" in
  rsync|"") ;;  # rsync is the only supported method (empty defaults to rsync)
  *)
    echo "ERROR: BACKUP_OFFSITE_METHOD must be 'rsync' (got: '${BACKUP_OFFSITE_METHOD}')" >&2
    exit 1
    ;;
esac

# Validate SSH key file exists if specified
if [ -n "${BACKUP_OFFSITE_SSH_KEY}" ]; then
  if [ ! -f "${BACKUP_OFFSITE_SSH_KEY}" ]; then
    echo "ERROR: BACKUP_OFFSITE_SSH_KEY does not exist: ${BACKUP_OFFSITE_SSH_KEY}" >&2
    exit 1
  fi
  # Key file must be 0600 (ssh refuses otherwise)
  KEY_PERMS=$(stat -c%a "${BACKUP_OFFSITE_SSH_KEY}" 2>/dev/null || stat -f%Lp "${BACKUP_OFFSITE_SSH_KEY}")
  if [ "${KEY_PERMS}" != "600" ] && [ "${KEY_PERMS}" != "400" ]; then
    warn "SSH key ${BACKUP_OFFSITE_SSH_KEY} has permissions ${KEY_PERMS} (expected 0600 or 0400)"
    warn "ssh may refuse to use it — run: chmod 600 ${BACKUP_OFFSITE_SSH_KEY}"
  fi
fi

# Compose file
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

# Strip trailing slash from BACKUP_OFFSITE_TARGET (we add one when rsyncing)
if [ -n "${BACKUP_OFFSITE_TARGET}" ]; then
  BACKUP_OFFSITE_TARGET="${BACKUP_OFFSITE_TARGET%/}"
fi

# Timestamp for filename
STAMP="$(date -u +%Y-%m-%d_%H%M)"
DATE_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BACKUP_NAME="tile_saas_${STAMP}"
BACKUP_FILE_RAW="${BACKUP_DIR}/${BACKUP_NAME}.sql"
BACKUP_FILE_ZST="${BACKUP_DIR}/${BACKUP_NAME}.sql.zst"
BACKUP_FILE_GPG="${BACKUP_DIR}/${BACKUP_NAME}.sql.zstd.gpg"

# Temporary directory for logs and intermediate files (cleaned on exit)
TMP_DIR=$(mktemp -d)
chmod 700 "${TMP_DIR}"

# ──────────────────────────────────────────────────────────
# Read previous status file at startup (to preserve last_success_at on failure)
# This is the FIX for the "stale status" bug — if a previous backup succeeded,
# we keep that timestamp until we have a NEW success to replace it.
# ──────────────────────────────────────────────────────────
PREV_LAST_SUCCESS_AT="null"
PREV_LAST_SUCCESS_SIZE="null"
PREV_LAST_SUCCESS_SHA256="null"
PREV_RESTORE_SUCCESS_AT="null"
PREV_RESTORE_FAILURE_AT="null"

if [ -f "${STATUS_FILE}" ]; then
  PREV_LAST_SUCCESS_AT=$(grep -o '"last_success_at": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  PREV_LAST_SUCCESS_AT="${PREV_LAST_SUCCESS_AT:-null}"

  PREV_LAST_SUCCESS_SIZE=$(grep -o '"last_success_size_bytes": [0-9]*' "${STATUS_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*' || echo "null")
  PREV_LAST_SUCCESS_SIZE="${PREV_LAST_SUCCESS_SIZE:-null}"

  PREV_LAST_SUCCESS_SHA256=$(grep -o '"last_success_sha256": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  PREV_LAST_SUCCESS_SHA256="${PREV_LAST_SUCCESS_SHA256:-null}"

  PREV_RESTORE_SUCCESS_AT=$(grep -o '"restore_test_last_success_at": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  PREV_RESTORE_SUCCESS_AT="${PREV_RESTORE_SUCCESS_AT:-null}"

  PREV_RESTORE_FAILURE_AT=$(grep -o '"restore_test_last_failure_at": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  PREV_RESTORE_FAILURE_AT="${PREV_RESTORE_FAILURE_AT:-null}"
fi

# In-memory status — initialized to "previous" values so failure preserves them
LAST_SUCCESS_AT="${PREV_LAST_SUCCESS_AT}"
LAST_SUCCESS_SIZE="${PREV_LAST_SUCCESS_SIZE}"
LAST_SUCCESS_SHA256="${PREV_LAST_SUCCESS_SHA256}"
LAST_FAILURE_AT="null"
LAST_FAILURE_REASON="null"

# Track failure state — set if anything fails before write_status_success
FAILED=false
FAILURE_REASON=""

# ──────────────────────────────────────────────────────────
# Status file writers — atomic write via temp file + rename
# ──────────────────────────────────────────────────────────
write_status_file() {
  # Arguments: last_success_at, last_failure_at, last_failure_reason,
  #            last_success_size, last_success_sha256,
  #            restore_test_success, restore_test_failure
  local ls_at="${1:-null}"
  local lf_at="${2:-null}"
  local lf_reason="${3:-null}"
  local ls_size="${4:-null}"
  local ls_sha="${5:-null}"
  local rt_success="${6:-null}"
  local rt_failure="${7:-null}"

  mkdir -p "${STATUS_DIR}"

  # Write to temp file first, then rename (atomic)
  local tmp_status
  tmp_status=$(mktemp "${STATUS_DIR}/.backup-status.XXXXXX")

  cat > "${tmp_status}" <<JSON
{
  "last_success_at": ${ls_at},
  "last_failure_at": ${lf_at},
  "last_failure_reason": ${lf_reason},
  "last_success_size_bytes": ${ls_size},
  "last_success_sha256": ${ls_sha},
  "backup_age_seconds": null,
  "restore_test_last_success_at": ${rt_success},
  "restore_test_last_failure_at": ${rt_failure},
  "retention_days": ${BACKUP_RETENTION_DAYS}
}
JSON

  # Set permissions: status file is read by app container, must be 0644
  chmod 0644 "${tmp_status}"

  # Atomic rename
  mv -f "${tmp_status}" "${STATUS_FILE}"
}

# Write a failure status — preserves previous last_success_* values
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
    "${PREV_RESTORE_SUCCESS_AT}" \
    "${PREV_RESTORE_FAILURE_AT}"
}

# Write a success status — clears any previous failure
write_status_success() {
  local success_ts="\"${DATE_ISO}\""

  write_status_file \
    "${success_ts}" \
    "null" \
    "null" \
    "${LAST_SUCCESS_SIZE}" \
    "\"${LAST_SUCCESS_SHA256}\"" \
    "${PREV_RESTORE_SUCCESS_AT}" \
    "${PREV_RESTORE_FAILURE_AT}"
}

# ──────────────────────────────────────────────────────────
# Cleanup on exit / error / signal — with double-cleanup guard
# ──────────────────────────────────────────────────────────
# وقتی Ctrl+C می‌زنیم (INT) یا cron SIGTERM می‌فرستد، این اتفاق می‌افتد:
#   ۱. signal handler اجرا می‌شود
#   ۲. cleanup اجرا می‌شود
#   ۳. exit با signal-appropriate code صدا زده می‌شود
#   ۴. EXIT trap اجرا می‌شود (چون exit صدا زده شد)
#   ۵. cleanup دوباره اجرا می‌شود — مگر اینکه CLEANUP_DONE guard داشته باشیم
#
# CLEANUP_DONE جلویِ اجرایِ دوباره‌ی cleanup را می‌گیرد. این مهم است چون:
#   - DROP DATABASE دوبار اجرا شود → خطای غلط
#   - logهای گمراه‌کننده چاپ شوند
#   - در شرایطِ rare، race condition پیش بیاید
CLEANUP_DONE=0

cleanup() {
  # Guard: only run once
  if [ "${CLEANUP_DONE}" -eq 1 ]; then
    return 0
  fi
  CLEANUP_DONE=1

  # Clean up intermediate files (raw dump and compressed-but-not-encrypted)
  rm -f "${BACKUP_FILE_RAW}" 2>/dev/null || true
  rm -f "${BACKUP_FILE_ZST}" 2>/dev/null || true
  rm -f "${BACKUP_DIR}/.pg_dump.log" 2>/dev/null || true

  # Clean up temp dir
  if [ -n "${TMP_DIR:-}" ] && [ -d "${TMP_DIR}" ]; then
    rm -rf "${TMP_DIR}" 2>/dev/null || true
  fi

  # If we failed before reaching write_status_success, write a failure status
  if [ "${FAILED}" = true ]; then
    error "Backup failed: ${FAILURE_REASON:-unknown}"
    write_status_failure "${FAILURE_REASON:-unknown}"
  fi
}

# Signal handler: cleanup + exit with signal-appropriate code
# (128 + signal_number is the conventional exit code for signal termination)
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
# 0. Pre-flight checks
# ──────────────────────────────────────────────────────────
log "Backup starting — ${DATE_ISO}"
log "Project root: ${PROJECT_ROOT}"
log "Backup target: ${BACKUP_FILE_GPG}"
log "Retention: ${BACKUP_RETENTION_DAYS} days"
if [ -n "${BACKUP_OFFSITE_TARGET}" ]; then
  log "Off-site target: ${BACKUP_OFFSITE_TARGET}/"
else
  warn "BACKUP_OFFSITE_TARGET not set — off-site copy will be skipped (NOT recommended for production)"
fi

# 0.1 Required commands
for cmd in gpg zstd docker; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    error "Required command not found: $cmd"
    FAILED=true
    FAILURE_REASON="missing_command_${cmd}"
    exit 1
  fi
done
ok "All required commands available: gpg, zstd, docker"

# 0.2 Docker Compose
if ! docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" ps postgres 2>/dev/null | grep -q "postgres"; then
  error "PostgreSQL container is not running. Start it with: docker compose -f ${COMPOSE_FILE} up -d postgres"
  FAILED=true
  FAILURE_REASON="postgres_container_not_running"
  exit 1
fi
ok "PostgreSQL container is running"

# 0.3 Backup directory exists
mkdir -p "${BACKUP_DIR}" "${STATUS_DIR}"

# ──────────────────────────────────────────────────────────
# 1. pg_dump
# ──────────────────────────────────────────────────────────
log "Step 1/6: pg_dump (custom format, includes RLS policies + SECURITY DEFINER functions)"

# Run pg_dump inside the container, output to host file via stdout redirect.
# -T disables TTY allocation (non-interactive, required for CI/cron).
# -e PGPASSWORD passes the password without it appearing in process args
#   inside the container (it's in the exec env, not the cmdline).
docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  pg_dump \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --verbose \
    > "${BACKUP_FILE_RAW}" 2>"${TMP_DIR}/pg_dump.log"

# Verify dump is non-empty
RAW_SIZE=$(stat -c%s "${BACKUP_FILE_RAW}" 2>/dev/null || stat -f%z "${BACKUP_FILE_RAW}")
if [ "${RAW_SIZE}" -lt 1024 ]; then
  error "pg_dump produced a file smaller than 1KB (${RAW_SIZE} bytes). Likely a failure."
  cat "${TMP_DIR}/pg_dump.log" >&2 || true
  FAILED=true
  FAILURE_REASON="pg_dump_too_small"
  exit 2
fi
ok "pg_dump OK — raw size: ${RAW_SIZE} bytes"

# Securely delete the raw dump log (it may contain DB schema details)
rm -f "${TMP_DIR}/pg_dump.log"

# ──────────────────────────────────────────────────────────
# 2. Compress with zstd
# ──────────────────────────────────────────────────────────
log "Step 2/6: zstd compression"
zstd -q -19 -f -o "${BACKUP_FILE_ZST}" "${BACKUP_FILE_RAW}"
ZST_SIZE=$(stat -c%s "${BACKUP_FILE_ZST}" 2>/dev/null || stat -f%z "${BACKUP_FILE_ZST}")
if [ "${ZST_SIZE}" -lt 100 ]; then
  error "zstd compression produced an empty file"
  FAILED=true
  FAILURE_REASON="zstd_failed"
  exit 3
fi
ok "zstd OK — compressed size: ${ZST_SIZE} bytes"

# Securely delete the raw dump (it contains unencrypted data)
rm -f "${BACKUP_FILE_RAW}"

# ──────────────────────────────────────────────────────────
# 3. Encrypt with GPG (symmetric AES-256)
# ──────────────────────────────────────────────────────────
log "Step 3/6: GPG encryption (symmetric AES-256)"

# Passphrase is piped via stdin (--passphrase-fd 0) — never appears in args.
# gpg stderr is captured to a temp log (NEVER to console) so that if gpg
# somehow prints the passphrase in an error message, it goes to a file
# that we control and delete, not to docker logs / journald.
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
  # Print the log to stderr — but gpg does NOT include the passphrase in errors
  # (it's read from fd 0, not echoed). Safe to print.
  cat "${TMP_DIR}/gpg_encrypt.log" >&2 || true
  FAILED=true
  FAILURE_REASON="gpg_encrypt_failed"
  rm -f "${BACKUP_FILE_ZST}" "${BACKUP_FILE_GPG}"
  exit 4
fi
GPG_SIZE=$(stat -c%s "${BACKUP_FILE_GPG}" 2>/dev/null || stat -f%z "${BACKUP_FILE_GPG}")
ok "GPG OK — encrypted size: ${GPG_SIZE} bytes"

# Set strict permissions on the encrypted backup file (0600 = owner-only)
chmod 600 "${BACKUP_FILE_GPG}"

# Securely delete the compressed-only file (it's unencrypted)
rm -f "${BACKUP_FILE_ZST}"

# ──────────────────────────────────────────────────────────
# 4. Checksum (SHA-256)
# ──────────────────────────────────────────────────────────
log "Step 4/6: SHA-256 checksum"
SHA256=$(sha256sum "${BACKUP_FILE_GPG}" | awk '{print $1}')
echo "${SHA256}  ${BACKUP_FILE_GPG}" > "${BACKUP_FILE_GPG}.sha256"
chmod 600 "${BACKUP_FILE_GPG}.sha256"
ok "SHA-256: ${SHA256}"

# ──────────────────────────────────────────────────────────
# 5. Decrypt verification (sanity check)
# ──────────────────────────────────────────────────────────
log "Step 5/6: Decrypt sanity check (verify GPG + zstd + PGDMP magic)"

# Decrypt to a temp file (inside TMP_DIR which is chmod 700) and verify
# it's a valid PostgreSQL dump. gpg stderr goes to a temp log, NOT to console.
if ! echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt "${BACKUP_FILE_GPG}" 2>"${TMP_DIR}/gpg_decrypt.log" \
  | zstd -d 2>"${TMP_DIR}/zstd_decompress.log" \
  > "${TMP_DIR}/verify.sql"; then
  error "GPG decrypt or zstd decompress failed"
  cat "${TMP_DIR}/gpg_decrypt.log" >&2 || true
  cat "${TMP_DIR}/zstd_decompress.log" >&2 || true
  FAILED=true
  FAILURE_REASON="decrypt_verify_failed"
  exit 4
fi

if [ ! -s "${TMP_DIR}/verify.sql" ]; then
  error "Decrypted file is empty"
  FAILED=true
  FAILURE_REASON="decrypt_verify_empty"
  exit 4
fi

# Check it's a real PostgreSQL custom-format dump (starts with "PGDMP")
MAGIC=$(head -c 5 "${TMP_DIR}/verify.sql")
if [ "${MAGIC}" != "PGDMP" ]; then
  error "Decrypted file does not start with PGDMP magic — not a valid pg_dump custom format"
  FAILED=true
  FAILURE_REASON="invalid_pgdump_format"
  exit 4
fi
ok "Decrypt + format verification OK (PGDMP magic present)"

# Clean up the decrypted verification file (it contains unencrypted DB data)
rm -f "${TMP_DIR}/verify.sql"

# ──────────────────────────────────────────────────────────
# 6. Off-site copy
# ──────────────────────────────────────────────────────────
log "Step 6/6: Off-site copy"

OFFSITE_OK="false"
if [ -z "${BACKUP_OFFSITE_TARGET}" ]; then
  warn "BACKUP_OFFSITE_TARGET is not set — skipping off-site copy"
  OFFSITE_OK="skipped"
elif [ "${BACKUP_OFFSITE_METHOD}" = "rsync" ]; then
  # Build rsync command as an ARRAY (no eval, no word-splitting bugs)
  # This is the FIX for the eval rsync vulnerability.
  local_rsync_args=(
    rsync
    -avz
    --timeout=300
  )

  if [ -n "${BACKUP_OFFSITE_SSH_KEY}" ]; then
    local_rsync_args+=(
      -e
      "ssh -i ${BACKUP_OFFSITE_SSH_KEY} -o StrictHostKeyChecking=accept-new -o BatchMode=yes"
    )
  fi

  log "rsync to ${BACKUP_OFFSITE_TARGET}/"

  # Run rsync — capture output to a temp log
  if "${local_rsync_args[@]}" "${BACKUP_FILE_GPG}" "${BACKUP_OFFSITE_TARGET}/" \
      > "${TMP_DIR}/rsync.log" 2>&1; then
    # Also sync the .sha256 file (best effort)
    if ! "${local_rsync_args[@]}" "${BACKUP_FILE_GPG}.sha256" "${BACKUP_OFFSITE_TARGET}/" \
        >> "${TMP_DIR}/rsync.log" 2>&1; then
      warn "Could not sync .sha256 file to off-site (non-fatal)"
    fi
    ok "rsync OK"
    OFFSITE_OK="true"
  else
    error "rsync failed (exit $?)"
    cat "${TMP_DIR}/rsync.log" >&2 || true
    FAILED=true
    FAILURE_REASON="rsync_failed"
    # Don't exit — local backup succeeded, just record failure.
    # The status file will be written with the failure reason.
    # BUT: we still want to record success for the local backup, so we
    # reset FAILED after writing the failure status for off-site.
    # Actually, the cleaner approach: write success status NOW (local is OK),
    # then attempt off-site, and if off-site fails, overwrite with failure.
    # Let's do that:
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
# Always set these — even if off-site failed, the local backup is valid.
LAST_SUCCESS_AT="\"${DATE_ISO}\""
LAST_SUCCESS_SIZE="${GPG_SIZE}"
LAST_SUCCESS_SHA256="\"${SHA256}\""

if [ "${OFFSITE_OK}" = "false" ]; then
  # Off-site failed but local backup is OK.
  # We write a SUCCESS status (last_success_at is set) but ALSO record
  # the off-site failure in last_failure_at + last_failure_reason.
  # This way, metrics shows: "backup succeeded locally, but off-site copy failed."
  write_status_file \
    "${LAST_SUCCESS_AT}" \
    "\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"" \
    "\"offsite_copy_failed\"" \
    "${LAST_SUCCESS_SIZE}" \
    "${LAST_SUCCESS_SHA256}" \
    "${PREV_RESTORE_SUCCESS_AT}" \
    "${PREV_RESTORE_FAILURE_AT}"
else
  write_status_success
fi

ok "Backup complete: ${BACKUP_FILE_GPG}"
ok "Size: ${GPG_SIZE} bytes | SHA-256: ${SHA256:0:16}..."

if [ "${OFFSITE_OK}" = "skipped" ]; then
  warn "Off-site copy SKIPPED — set BACKUP_OFFSITE_TARGET for production"
elif [ "${OFFSITE_OK}" = "true" ]; then
  ok "Off-site copy: OK"
else
  warn "Off-site copy FAILED — local backup OK but no off-site redundancy"
  warn "Check /api/metrics → backup.last_failure_reason"
fi

# Reset FAILED so the EXIT trap doesn't write a failure status
FAILED=false

# Note: we don't reset traps here. The CLEANUP_DONE guard prevents
# double-cleanup if a signal fires during the last few lines.
# EXIT trap will run cleanup() one final time — which will clean up
# TMP_DIR. CLEANUP_DONE guard ensures it's a no-op if already cleaned.
exit 0
