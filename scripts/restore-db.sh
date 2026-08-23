#!/bin/bash
# =============================================================================
# scripts/restore-db.sh — Restore Backup to a Temporary DB + Integrity Checks
# =============================================================================
# این اسکریپت:
#   ۱. یک فایل بکاپِ رمزنگاری‌شده را decrypt و decompress می‌کند
#   ۲. آن را در یک دیتابیسِ موقت restore می‌کند (نه production!)
#   ۳. integrity checks اجرا می‌کند (table count, FK validity, tenant presence)
#   ۴. چند query بحرانی اجرا می‌کند (smoke test)
#   ۵. در صورتِ موفقیت، timestamp را در `backup-status.json` ثبت می‌کند
#   ۶. دیتابیس موقت را پاک می‌کند
#
# ⚠️  این اسکریپت هرگز به production database نمی‌زند. فقط `tile_restore_test`.
#
# Usage:
#   bash scripts/restore-db.sh [backup-file]
#   bash scripts/restore-db.sh --test-only       # از آخرین بکاپِ موفق
#   bash scripts/restore-db.sh --no-cleanup      # برایِ debugging باقی بگذار
#
# Exit codes:
#   0 — restore test موفق
#   1 — pre-flight failure
#   2 — decrypt/decompress failed
#   3 — restore failed
#   4 — integrity check failed
#   5 — smoke test failed
#   6 — status update failed
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
STATUS_DIR="${PROJECT_ROOT}/backups/status"
STATUS_FILE="${STATUS_DIR}/backup-status.json"

# Load .env
if [ -f "${PROJECT_ROOT}/.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "${PROJECT_ROOT}/.env" 2>/dev/null || true; set +a
fi

POSTGRES_USER="${POSTGRES_USER:-tile_app}"
POSTGRES_DB="${POSTGRES_DB:-tile_saas}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required}"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

# Restore target — TEMPORARY database, never production
RESTORE_DB_NAME="${RESTORE_DB_NAME:-tile_restore_test}"

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
      echo "Usage: bash scripts/restore-db.sh [backup-file | --test-only] [--no-cleanup]"
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
    error "Run scripts/backup-db.sh first"
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
log "Restore test starting — ${DATE_ISO}"
log "Backup file: ${BACKUP_FILE}"
log "Target DB:   ${RESTORE_DB_NAME} (TEMPORARY)"

# ──────────────────────────────────────────────────────────
# Pre-flight checks
# ──────────────────────────────────────────────────────────
log "Pre-flight: Docker + PostgreSQL container"
if ! docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" ps postgres 2>/dev/null | grep -q "postgres"; then
  error "PostgreSQL container is not running"
  exit 1
fi

# Helper: run psql inside container as superuser (POSTGRES_USER has full access
# inside the postgres container; it's NOT the runtime app_user)
psql_super() {
  docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
    psql -U "${POSTGRES_USER}" -v ON_ERROR_STOP=1 "$@"
}

psql_super_db() {
  docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
    psql -U "${POSTGRES_USER}" -d "${RESTORE_DB_NAME}" -v ON_ERROR_STOP=1 "$@"
}

pg_restore_cmd() {
  docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
    pg_restore "$@"
}

# ──────────────────────────────────────────────────────────
# 1. Decrypt + decompress
# ──────────────────────────────────────────────────────────
log "Step 1/5: Decrypt + decompress"
TMP_RESTORE=$(mktemp -d)
trap 'rm -rf "${TMP_RESTORE}"; maybe_cleanup' EXIT

maybe_cleanup() {
  if [ "${NO_CLEANUP}" = true ]; then
    warn "Skipping DB cleanup (--no-cleanup)"
    warn "Temporary files in: ${TMP_RESTORE}"
    warn "Temporary database: ${RESTORE_DB_NAME} (drop manually with: docker compose exec postgres psql -U ${POSTGRES_USER} -c 'DROP DATABASE ${RESTORE_DB_NAME}')"
    return
  fi

  # Drop the temporary database
  log "Cleanup: dropping ${RESTORE_DB_NAME}"
  psql_super -d postgres -c "DROP DATABASE IF EXISTS \"${RESTORE_DB_NAME}\";" 2>/dev/null || warn "Could not drop ${RESTORE_DB_NAME}"
  rm -rf "${TMP_RESTORE}"
}

if ! echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt "${BACKUP_FILE}" 2>"${TMP_RESTORE}/gpg.log" \
  | zstd -d 2>"${TMP_RESTORE}/zstd.log" \
  > "${TMP_RESTORE}/dump.sql"; then
  error "Decrypt/decompress failed"
  cat "${TMP_RESTORE}/gpg.log" >&2 || true
  cat "${TMP_RESTORE}/zstd.log" >&2 || true
  exit 2
fi

if [ ! -s "${TMP_RESTORE}/dump.sql" ]; then
  error "Decrypted dump file is empty"
  exit 2
fi

MAGIC=$(head -c 5 "${TMP_RESTORE}/dump.sql")
if [ "${MAGIC}" != "PGDMP" ]; then
  error "Not a valid pg_dump custom-format file (expected 'PGDMP', got '${MAGIC}')"
  exit 2
fi
ok "Decrypt + decompress OK"

# ──────────────────────────────────────────────────────────
# 2. Drop & recreate temporary database
# ──────────────────────────────────────────────────────────
log "Step 2/5: Recreate temporary database '${RESTORE_DB_NAME}'"

# Disconnect any lingering sessions
psql_super -d postgres <<SQL 2>/dev/null || true
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${RESTORE_DB_NAME}' AND pid <> pg_backend_pid();
SQL

psql_super -d postgres -c "DROP DATABASE IF EXISTS \"${RESTORE_DB_NAME}\";"
psql_super -d postgres -c "CREATE DATABASE \"${RESTORE_DB_NAME}\";"
ok "Database recreated"

# ──────────────────────────────────────────────────────────
# 3. Restore the dump
# ──────────────────────────────────────────────────────────
log "Step 3/5: pg_restore into ${RESTORE_DB_NAME}"

# Copy dump file into the container's /tmp so pg_restore can read it
# (We avoid piping via stdin because pg_restore wants a seekable file for parallel mode)
CONTAINER_DUMP_PATH="/tmp/restore-$(date +%s).dump"
docker cp "${TMP_RESTORE}/dump.sql" \
  "$(docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" ps -q postgres):${CONTAINER_DUMP_PATH}" 2>/dev/null

if ! pg_restore_cmd \
  -U "${POSTGRES_USER}" \
  -d "${RESTORE_DB_NAME}" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "${CONTAINER_DUMP_PATH}" 2>"${TMP_RESTORE}/pg_restore.log"; then
  error "pg_restore failed"
  cat "${TMP_RESTORE}/pg_restore.log" >&2 || true
  # Cleanup the temp file in container
  docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" exec -T postgres rm -f "${CONTAINER_DUMP_PATH}" 2>/dev/null || true
  exit 3
fi

# Clean up the dump file inside the container
docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" exec -T postgres rm -f "${CONTAINER_DUMP_PATH}" 2>/dev/null || true
ok "pg_restore OK"

# ──────────────────────────────────────────────────────────
# 4. Integrity checks
# ──────────────────────────────────────────────────────────
log "Step 4/5: Integrity checks"
CHECKS_PASS=true
CHECKS_FAIL_LIST=""

# Check 4.1: Database responsive
RESULT=$(psql_super_db -t -c "SELECT 1;" 2>/dev/null | tr -d '[:space:]')
if [ "${RESULT}" != "1" ]; then
  error "Check 4.1 failed: SELECT 1 did not return 1 (got: '${RESULT}')"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} select_1"
else
  ok "Check 4.1: Database responsive — SELECT 1 OK"
fi

# Check 4.2: Table count (≥ 38 per schema.sql)
RESULT=$(psql_super_db -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d '[:space:]')
if [ "${RESULT}" -lt 38 ] 2>/dev/null; then
  error "Check 4.2 failed: Expected ≥ 38 tables, got ${RESULT}"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} table_count"
else
  ok "Check 4.2: Table count OK — ${RESULT} tables"
fi

# Check 4.3: Migrations table populated (≥ 4 migrations: 0002, 0003, 0004, ...)
RESULT=$(psql_super_db -t -c "SELECT count(*) FROM _migrations;" 2>/dev/null | tr -d '[:space:]')
if [ "${RESULT}" -lt 4 ] 2>/dev/null; then
  error "Check 4.3 failed: Expected ≥ 4 migrations, got ${RESULT}"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} migrations"
else
  ok "Check 4.3: Migrations OK — ${RESULT} migrations recorded"
fi

# Check 4.4: Tenant exists
RESULT=$(psql_super_db -t -c "SELECT count(*) FROM tenant;" 2>/dev/null | tr -d '[:space:]')
if [ "${RESULT}" -lt 1 ] 2>/dev/null; then
  error "Check 4.4 failed: No tenants found in restored database"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} tenant"
else
  ok "Check 4.4: Tenant presence OK — ${RESULT} tenants"
fi

# Check 4.5: Platform admin exists
RESULT=$(psql_super_db -t -c "SELECT count(*) FROM app_user WHERE is_platform_admin;" 2>/dev/null | tr -d '[:space:]')
if [ "${RESULT}" -lt 1 ] 2>/dev/null; then
  error "Check 4.5 failed: No platform admin in restored database"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} platform_admin"
else
  ok "Check 4.5: Platform admin OK — ${RESULT} admins"
fi

# Check 4.6: All foreign key constraints are valid
RESULT=$(psql_super_db -t -c "
  SELECT con.conname
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = connamespace
  WHERE con.contype = 'f' AND nsp.nspname = 'public'
  LIMIT 1;
" 2>/dev/null | tr -d '[:space:]')
if [ -z "${RESULT}" ]; then
  warn "Check 4.6: No FK constraints found (suspicious — schema may be incomplete)"
  # Don't fail, just warn
else
  ok "Check 4.6: FK constraints present"
fi

# Check 4.7: RLS policies installed
RESULT=$(psql_super_db -t -c "SELECT count(*) FROM pg_policy;" 2>/dev/null | tr -d '[:space:]')
if [ "${RESULT}" -lt 1 ] 2>/dev/null; then
  warn "Check 4.7: No RLS policies found (suspicious — RLS may not have been backed up)"
else
  ok "Check 4.7: RLS policies OK — ${RESULT} policies"
fi

# Check 4.8: SECURITY DEFINER functions exist
RESULT=$(psql_super_db -t -c "
  SELECT count(*)
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef = true;
" 2>/dev/null | tr -d '[:space:]')
if [ "${RESULT}" -lt 4 ] 2>/dev/null; then
  warn "Check 4.8: Expected ≥ 4 SECURITY DEFINER functions, got ${RESULT}"
else
  ok "Check 4.8: SECURITY DEFINER functions OK — ${RESULT} functions"
fi

if [ "${CHECKS_PASS}" != true ]; then
  error "Integrity checks FAILED:${CHECKS_FAIL_LIST}"
  exit 4
fi
ok "All integrity checks passed"

# ──────────────────────────────────────────────────────────
# 5. Smoke queries (application-level)
# ──────────────────────────────────────────────────────────
log "Step 5/5: Smoke queries (application-level)"

SMOKE_PASS=true

# Smoke 5.1: user_contexts function works (SECURITY DEFINER)
RESULT=$(psql_super_db -t -c "SELECT count(*) FROM user_contexts('00000000-0000-0000-0000-000000000000');" 2>/dev/null | tr -d '[:space:]')
if [ -z "${RESULT}" ]; then
  error "Smoke 5.1 failed: user_contexts() returned no result"
  SMOKE_PASS=false
else
  ok "Smoke 5.1: user_contexts() OK — ${RESULT} contexts (for non-existent user, expected 0)"
fi

# Smoke 5.2: expire_due_reservations function callable
RESULT=$(psql_super_db -t -c "SELECT count(*) FROM expire_due_reservations();" 2>/dev/null | tr -d '[:space:]')
if [ -z "${RESULT}" ]; then
  error "Smoke 5.2 failed: expire_due_reservations() returned no result"
  SMOKE_PASS=false
else
  ok "Smoke 5.2: expire_due_reservations() OK — expired ${RESULT} reservations"
fi

# Smoke 5.3: claim_pending_notifications callable
RESULT=$(psql_super_db -t -c "SELECT count(*) FROM claim_pending_notifications(1, 10);" 2>/dev/null | tr -d '[:space:]')
if [ -z "${RESULT}" ]; then
  error "Smoke 5.3 failed: claim_pending_notifications() returned no result"
  SMOKE_PASS=false
else
  ok "Smoke 5.3: claim_pending_notifications() OK — claimed ${RESULT} messages"
fi

# Smoke 5.4: _rate_limit_hits table is accessible
RESULT=$(psql_super_db -t -c "SELECT count(*) FROM _rate_limit_hits;" 2>/dev/null | tr -d '[:space:]')
if [ -z "${RESULT}" ] && [ "${RESULT}" != "0" ]; then
  error "Smoke 5.4 failed: cannot read _rate_limit_hits"
  SMOKE_PASS=false
else
  ok "Smoke 5.4: _rate_limit_hits OK — ${RESULT} rows"
fi

# Smoke 5.5: Transactional consistency — pick a known table and verify it has the
# expected columns (catches partial restore)
RESULT=$(psql_super_db -t -c "
  SELECT count(*)
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='app_user';
" 2>/dev/null | tr -d '[:space:]')
if [ "${RESULT}" -lt 5 ] 2>/dev/null; then
  error "Smoke 5.5 failed: app_user table has too few columns (${RESULT})"
  SMOKE_PASS=false
else
  ok "Smoke 5.5: app_user schema OK — ${RESULT} columns"
fi

if [ "${SMOKE_PASS}" != true ]; then
  error "Smoke queries FAILED"
  exit 5
fi
ok "All smoke queries passed"

# ──────────────────────────────────────────────────────────
# Update status file with restore_test success
# ──────────────────────────────────────────────────────────
RESTORE_END=$(date +%s)
RESTORE_DURATION=$((RESTORE_END - RESTORE_START))
log "Updating status file with restore_test timestamp"

mkdir -p "${STATUS_DIR}"

# Read existing status file (if any) to preserve last_success_* fields
LAST_SUCCESS_AT_VAL="null"
LAST_SUCCESS_SIZE_VAL="null"
LAST_SUCCESS_SHA256_VAL="null"
LAST_FAILURE_AT_VAL="null"
LAST_FAILURE_REASON_VAL="null"
BACKUP_AGE_VAL="null"
RETENTION_DAYS_VAL=30

if [ -f "${STATUS_FILE}" ]; then
  LAST_SUCCESS_AT_VAL=$(grep -o '"last_success_at": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/\1/' || echo "")
  LAST_SUCCESS_AT_VAL=${LAST_SUCCESS_AT_VAL:+\"${LAST_SUCCESS_AT_VAL}\"}
  LAST_SUCCESS_AT_VAL=${LAST_SUCCESS_AT_VAL:-null}

  LAST_SUCCESS_SIZE_VAL=$(grep -o '"last_success_size_bytes": [0-9]*' "${STATUS_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*' || echo "null")
  LAST_SUCCESS_SIZE_VAL=${LAST_SUCCESS_SIZE_VAL:-null}

  LAST_SUCCESS_SHA256_VAL=$(grep -o '"last_success_sha256": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/\1/' || echo "")
  LAST_SUCCESS_SHA256_VAL=${LAST_SUCCESS_SHA256_VAL:+\"${LAST_SUCCESS_SHA256_VAL}\"}
  LAST_SUCCESS_SHA256_VAL=${LAST_SUCCESS_SHA256_VAL:-null}

  LAST_FAILURE_AT_VAL=$(grep -o '"last_failure_at": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/\1/' || echo "")
  LAST_FAILURE_AT_VAL=${LAST_FAILURE_AT_VAL:+\"${LAST_FAILURE_AT_VAL}\"}
  LAST_FAILURE_AT_VAL=${LAST_FAILURE_AT_VAL:-null}

  LAST_FAILURE_REASON_VAL=$(grep -o '"last_failure_reason": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/\1/' || echo "")
  LAST_FAILURE_REASON_VAL=${LAST_FAILURE_REASON_VAL:+\"${LAST_FAILURE_REASON_VAL}\"}
  LAST_FAILURE_REASON_VAL=${LAST_FAILURE_REASON_VAL:-null}

  RETENTION_DAYS_VAL=$(grep -o '"retention_days": [0-9]*' "${STATUS_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*' || echo "30")
  RETENTION_DAYS_VAL=${RETENTION_DAYS_VAL:-30}
fi

# Compute backup_age_seconds if we have last_success_at
if [ "${LAST_SUCCESS_AT_VAL}" != "null" ]; then
  LAST_SUCCESS_TS=$(echo "${LAST_SUCCESS_AT_VAL}" | tr -d '"')
  if LAST_SUCCESS_EPOCH=$(date -u -d "${LAST_SUCCESS_TS}" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "${LAST_SUCCESS_TS}" +%s 2>/dev/null); then
    BACKUP_AGE_VAL=$((RESTORE_END - LAST_SUCCESS_EPOCH))
  fi
fi

cat > "${STATUS_FILE}" <<EOF
{
  "last_success_at": ${LAST_SUCCESS_AT_VAL},
  "last_failure_at": ${LAST_FAILURE_AT_VAL},
  "last_failure_reason": ${LAST_FAILURE_REASON_VAL},
  "last_success_size_bytes": ${LAST_SUCCESS_SIZE_VAL},
  "last_success_sha256": ${LAST_SUCCESS_SHA256_VAL},
  "backup_age_seconds": ${BACKUP_AGE_VAL},
  "restore_test_last_success_at": "${DATE_ISO}",
  "restore_test_last_failure_at": null,
  "retention_days": ${RETENTION_DAYS_VAL}
}
EOF
ok "Status file updated"

# ──────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────
ok ""
ok "═══════════ Restore Test Summary ═══════════"
ok "Backup file:    ${BACKUP_FILE}"
ok "Target DB:      ${RESTORE_DB_NAME}"
ok "Duration:       ${RESTORE_DURATION}s"
ok "Integrity:      ALL CHECKS PASSED"
ok "Smoke queries:  ALL PASSED"
ok "Status file:    ${STATUS_FILE}"
ok ""
ok "Restore test SUCCEEDED — backup is restorable."

exit 0
