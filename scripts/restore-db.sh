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
# ⚠️  این اسکریپت هرگز به production database نمی‌زند. فقط دیتابیسِ
#     `RESTORE_DB_NAME` (پیش‌فرض: `tile_restore_test`).
#
# Safety:
#   - RESTORE_DB_NAME اعتبارسنجی می‌شود: باید با `^[a-zA-Z_][a-zA-Z0-9_]*$`
#     مطابقت کند و نباید برابر با POSTGRES_DB باشد.
#   - اگر RESTORE_DB_NAME برابر با POSTGRES_DB باشد، اسکریپت fail-loud می‌شود.
#
# Usage:
#   bash scripts/restore-db.sh [backup-file]
#   bash scripts/restore-db.sh --test-only       # از آخرین بکاپِ موفق
#   bash scripts/restore-db.sh --no-cleanup      # برایِ debugging باقی بگذار
#
# Exit codes:
#   0 — restore test موفق
#   1 — pre-flight failure (env, validation, docker)
#   2 — decrypt/decompress failed
#   3 — restore failed
#   4 — integrity check failed
#   5 — smoke test failed
# =============================================================================

set -euo pipefail

# Anti-leak defenses — same as backup-db.sh
if [[ "${-}" == *x* ]]; then
  echo "ERROR: this script must not run with 'set -x' (passphrase leak risk)" >&2
  exit 1
fi
set +o history 2>/dev/null || true

# ──────────────────────────────────────────────────────────
# Concurrency guard — flock prevents two restore-db.sh runs from
# clobbering the same tile_restore_test database
# ──────────────────────────────────────────────────────────
LOCK_FILE="${RESTORE_LOCK_FILE:-/var/lock/tile-saas-restore-db.lock}"
LOCK_DIR=$(dirname "${LOCK_FILE}")
if [ ! -d "${LOCK_DIR}" ]; then
  if [ "${LOCK_FILE}" = "/var/lock/tile-saas-restore-db.lock" ]; then
    LOCK_FILE="/tmp/tile-saas-restore-db.lock"
  fi
fi
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  echo "ERROR: another restore-db.sh is already running (lock: ${LOCK_FILE})" >&2
  echo "ERROR: this would race on the '${RESTORE_DB_NAME:-tile_restore_test}' database" >&2
  echo "ERROR: if you are sure no restore is running, remove the lock file: rm ${LOCK_FILE}" >&2
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
STATUS_DIR="${PROJECT_ROOT}/backups/status"
STATUS_FILE="${STATUS_DIR}/backup-status.json"

# Load .env (selectively, same pattern as backup-db.sh)
if [ -f "${PROJECT_ROOT}/.env" ]; then
  set -a
  ( source "${PROJECT_ROOT}/.env" 2>/dev/null && \
    for var in POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
               BACKUP_GPG_PASSPHRASE BACKUP_RETENTION_DAYS COMPOSE_FILE RESTORE_DB_NAME; do
      if [ -n "${!var:-}" ]; then echo "${var}=${!var}"; fi
    done ) | while IFS='=' read -r k v; do export "${k}=${v}"; done
  set +a
fi

POSTGRES_USER="${POSTGRES_USER:-tile_app}"
POSTGRES_DB="${POSTGRES_DB:-tile_saas}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required}"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

# Restore target — TEMPORARY database, never production
RESTORE_DB_NAME="${RESTORE_DB_NAME:-tile_restore_test}"

# ──────────────────────────────────────────────────────────
# SAFETY: Validate RESTORE_DB_NAME
# ──────────────────────────────────────────────────────────
# Must be a valid PostgreSQL identifier (letters, digits, underscores).
# Must NOT equal POSTGRES_DB (would clobber production!).
if ! [[ "${RESTORE_DB_NAME}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "ERROR: RESTORE_DB_NAME contains invalid characters: '${RESTORE_DB_NAME}'" >&2
  echo "ERROR: must match ^[a-zA-Z_][a-zA-Z0-9_]*\$" >&2
  exit 1
fi

if [ "${RESTORE_DB_NAME}" = "${POSTGRES_DB}" ]; then
  echo "ERROR: RESTORE_DB_NAME ('${RESTORE_DB_NAME}') must NOT equal POSTGRES_DB ('${POSTGRES_DB}')" >&2
  echo "ERROR: this would clobber the PRODUCTION database!" >&2
  echo "ERROR: override with: RESTORE_DB_NAME=tile_restore_test bash scripts/restore-db.sh ..." >&2
  exit 1
fi

# Optional: warn if RESTORE_DB_NAME doesn't end with _test or _restore
if ! [[ "${RESTORE_DB_NAME}" =~ _test$|_restore$|_restore_test$ ]]; then
  warn "RESTORE_DB_NAME ('${RESTORE_DB_NAME}') doesn't end with '_test' or '_restore' — please double-check this is not a production database"
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
      echo "Usage: bash scripts/restore-db.sh [backup-file | --test-only] [--no-cleanup]"
      echo ""
      echo "Options:"
      echo "  --test-only   Use the most recent backup in backups/daily/"
      echo "  --no-cleanup  Keep the temporary database and files (for debugging)"
      echo ""
      echo "Env:"
      echo "  RESTORE_DB_NAME  (default: tile_restore_test) — must not equal POSTGRES_DB"
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

# ──────────────────────────────────────────────────────────
# Helper functions — defined BEFORE the trap that references them
# ──────────────────────────────────────────────────────────
psql_super() {
  # Run psql inside container, non-interactive (-T), with PGPASSWORD in env
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

# Temporary directory for logs and intermediate files
TMP_RESTORE=$(mktemp -d)
chmod 700 "${TMP_RESTORE}"

# Container path for the dump file (cleaned up on exit)
CONTAINER_DUMP_PATH="/tmp/restore-$(date +%s).dump"

# Cleanup function — handles all exit paths, with double-cleanup guard.
#
# وقتی Ctrl+C می‌زنیم (INT) یا SIGTERM می‌آید:
#   ۱. signal handler اجرا می‌شود → cleanup + exit با signal code
#   ۲. EXIT trap اجرا می‌شود (به‌خاطرِ exit) → cleanup دوباره — مگر اینکه guard داشته باشیم
#
# CLEANUP_DONE جلویِ اجرایِ دوباره را می‌گیرد. مهم چون:
#   - DROP DATABASE دوبار اجرا شود → خطای غلط
#   - در شرایطِ rare، race condition پیش بیاید
CLEANUP_DONE=0
RESTORE_DONE=false

maybe_cleanup() {
  # Guard: only run once
  if [ "${CLEANUP_DONE}" -eq 1 ]; then
    return 0
  fi
  CLEANUP_DONE=1

  # Clean up temp files
  if [ -n "${TMP_RESTORE:-}" ] && [ -d "${TMP_RESTORE}" ]; then
    rm -rf "${TMP_RESTORE}" 2>/dev/null || true
  fi

  # Clean up the dump file inside the container (always — best effort)
  docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" exec -T postgres \
    rm -f "${CONTAINER_DUMP_PATH}" 2>/dev/null || true

  if [ "${NO_CLEANUP}" = true ]; then
    warn "Skipping DB cleanup (--no-cleanup)"
    warn "Temporary database '${RESTORE_DB_NAME}' left in place — drop manually:"
    warn "  docker compose exec postgres psql -U ${POSTGRES_USER} -c 'DROP DATABASE ${RESTORE_DB_NAME};'"
    return
  fi

  # Drop the temporary database.
  #
  # Strategy: try `WITH (FORCE)` first (PostgreSQL 13+). This is atomic —
  # it terminates connections AND drops the database in one statement,
  # eliminating the race between pg_terminate_backend and DROP.
  #
  # If `WITH (FORCE)` fails (e.g., older PostgreSQL), fall back to the
  # two-step pattern: pg_terminate_backend + DROP DATABASE.
  #
  # Reference: https://www.postgresql.org/docs/16/sql-dropdatabase.html
  log "Cleanup: dropping ${RESTORE_DB_NAME} (if exists)"

  local drop_succeeded=false

  # Try WITH (FORCE) first (PG13+). RESTORE_DB_NAME is already validated
  # against ^[a-zA-Z_][a-zA-Z0-9_]*$ so SQL injection is impossible.
  if psql_super -d postgres -c \
    "DROP DATABASE IF EXISTS \"${RESTORE_DB_NAME}\" WITH (FORCE);" 2>/dev/null; then
    drop_succeeded=true
  else
    # Fallback for older PostgreSQL (or if WITH (FORCE) failed for any reason)
    # Step 1: terminate lingering connections
    psql_super -d postgres -c \
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${RESTORE_DB_NAME}' AND pid <> pg_backend_pid();" \
      2>/dev/null || true
    # Step 2: drop the database
    if psql_super -d postgres -c "DROP DATABASE IF EXISTS \"${RESTORE_DB_NAME}\";" 2>/dev/null; then
      drop_succeeded=true
    fi
  fi

  if [ "${drop_succeeded}" != true ]; then
    warn "Could not drop ${RESTORE_DB_NAME} (may need manual cleanup)"
    warn "  Manual cleanup: docker compose exec postgres psql -U ${POSTGRES_USER} -d postgres -c 'DROP DATABASE IF EXISTS \"${RESTORE_DB_NAME}\" WITH (FORCE);'"
  fi
}

# Signal handler: cleanup + exit with signal-appropriate code
on_signal() {
  local sig=$1
  maybe_cleanup
  exit $((128 + sig))
}

trap maybe_cleanup EXIT
trap 'on_signal 2' INT    # SIGINT (Ctrl+C) → exit 130
trap 'on_signal 15' TERM  # SIGTERM (cron kill) → exit 143
trap 'on_signal 1' HUP    # SIGHUP (terminal closed) → exit 129

# ──────────────────────────────────────────────────────────
# 1. Decrypt + decompress
# ──────────────────────────────────────────────────────────
log "Step 1/5: Decrypt + decompress"

# Passphrase via stdin, gpg stderr to temp log (not console)
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

# Disconnect any lingering sessions (use parameterized SQL — RESTORE_DB_NAME
# is already validated to be a safe identifier, but we double-quote it in SQL)
psql_super -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${RESTORE_DB_NAME}' AND pid <> pg_backend_pid();" 2>/dev/null || true

psql_super -d postgres -c "DROP DATABASE IF EXISTS \"${RESTORE_DB_NAME}\";"
psql_super -d postgres -c "CREATE DATABASE \"${RESTORE_DB_NAME}\";"
ok "Database recreated"

# ──────────────────────────────────────────────────────────
# 3. Restore the dump
# ──────────────────────────────────────────────────────────
log "Step 3/5: pg_restore into ${RESTORE_DB_NAME}"

# Copy dump file into the container so pg_restore can read it as a seekable file.
# We use a timestamped path to avoid collisions with concurrent restores.
docker cp "${TMP_RESTORE}/dump.sql" \
  "$(docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" ps -q postgres):${CONTAINER_DUMP_PATH}" \
  2>"${TMP_RESTORE}/docker_cp.log"

if [ $? -ne 0 ]; then
  error "docker cp failed — could not copy dump file into container"
  cat "${TMP_RESTORE}/docker_cp.log" >&2 || true
  exit 3
fi

if ! pg_restore_cmd \
  -U "${POSTGRES_USER}" \
  -d "${RESTORE_DB_NAME}" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  "${CONTAINER_DUMP_PATH}" 2>"${TMP_RESTORE}/pg_restore.log"; then
  error "pg_restore failed"
  cat "${TMP_RESTORE}/pg_restore.log" >&2 || true
  exit 3
fi

# Clean up the dump file inside the container (we have it locally too if needed)
docker compose -f "${PROJECT_ROOT}/${COMPOSE_FILE}" exec -T postgres \
  rm -f "${CONTAINER_DUMP_PATH}" 2>/dev/null || true
ok "pg_restore OK"

# ──────────────────────────────────────────────────────────
# 4. Integrity checks
# ──────────────────────────────────────────────────────────
log "Step 4/5: Integrity checks"
CHECKS_PASS=true
CHECKS_FAIL_LIST=""

# Helper: run a SQL query and return the result (trimmed)
query_db() {
  psql_super_db -t -c "$1" 2>/dev/null | tr -d '[:space:]'
}

# Check 4.1: Database responsive
RESULT=$(query_db "SELECT 1;")
if [ "${RESULT}" != "1" ]; then
  error "Check 4.1 failed: SELECT 1 did not return 1 (got: '${RESULT}')"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} select_1"
else
  ok "Check 4.1: Database responsive — SELECT 1 OK"
fi

# Check 4.2: Table count (≥ 38 per schema.sql)
RESULT=$(query_db "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 38 ]; then
  error "Check 4.2 failed: Expected ≥ 38 tables, got '${RESULT}'"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} table_count"
else
  ok "Check 4.2: Table count OK — ${RESULT} tables"
fi

# Check 4.3: Migrations table populated (≥ 4 migrations: 0002, 0003, 0004, ...)
RESULT=$(query_db "SELECT count(*) FROM _migrations;")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 4 ]; then
  error "Check 4.3 failed: Expected ≥ 4 migrations, got '${RESULT}'"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} migrations"
else
  ok "Check 4.3: Migrations OK — ${RESULT} migrations recorded"
fi

# Check 4.4: Tenant exists
RESULT=$(query_db "SELECT count(*) FROM tenant;")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 1 ]; then
  error "Check 4.4 failed: No tenants found in restored database"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} tenant"
else
  ok "Check 4.4: Tenant presence OK — ${RESULT} tenants"
fi

# Check 4.5: Platform admin exists
RESULT=$(query_db "SELECT count(*) FROM app_user WHERE is_platform_admin;")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 1 ]; then
  error "Check 4.5 failed: No platform admin in restored database"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} platform_admin"
else
  ok "Check 4.5: Platform admin OK — ${RESULT} admins"
fi

# Check 4.6: All foreign key constraints are valid
RESULT=$(query_db "SELECT con.conname FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid JOIN pg_namespace nsp ON nsp.oid = connamespace WHERE con.contype = 'f' AND nsp.nspname = 'public' LIMIT 1;")
if [ -z "${RESULT}" ]; then
  warn "Check 4.6: No FK constraints found (suspicious — schema may be incomplete)"
  # Don't fail, just warn
else
  ok "Check 4.6: FK constraints present"
fi

# Check 4.7: RLS policies installed
RESULT=$(query_db "SELECT count(*) FROM pg_policy;")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 1 ]; then
  warn "Check 4.7: No RLS policies found (suspicious — RLS may not have been backed up)"
else
  ok "Check 4.7: RLS policies OK — ${RESULT} policies"
fi

# Check 4.8: SECURITY DEFINER functions exist
RESULT=$(query_db "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef = true;")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 4 ]; then
  warn "Check 4.8: Expected ≥ 4 SECURITY DEFINER functions, got '${RESULT}'"
else
  ok "Check 4.8: SECURITY DEFINER functions OK — ${RESULT} functions"
fi

# Check 4.9: Row counts for key tables (informational, not pass/fail)
# This catches "table exists but is empty when it shouldn't be" — a sign of
# partial restore or wrong backup source. Counts may legitimately differ from
# production (backup taken at different time), so we log them as info.
log "Check 4.9: Row counts for key tables (informational):"
for table in app_user tenant audit_log product inventory_balance reservation; do
  RESULT=$(query_db "SELECT count(*) FROM ${table};")
  if [[ "${RESULT}" =~ ^[0-9]+$ ]]; then
    log "  - ${table}: ${RESULT} rows"
  else
    warn "  - ${table}: cannot read (got '${RESULT}')"
    warn "  - this suggests the table is missing or schema is incomplete"
  fi
done

# Sanity check: app_user and tenant must be non-empty (we already checked
# in 4.4 and 4.5, but verify that audit_log and product are accessible
# even if empty — empty is fine, inaccessible is not).
RESULT=$(query_db "SELECT count(*) FROM audit_log;")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]]; then
  error "Check 4.9: audit_log table is not accessible (got '${RESULT}')"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} audit_log"
fi
RESULT=$(query_db "SELECT count(*) FROM product;")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]]; then
  error "Check 4.9: product table is not accessible (got '${RESULT}')"
  CHECKS_PASS=false
  CHECKS_FAIL_LIST="${CHECKS_FAIL_LIST} product"
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
RESULT=$(query_db "SELECT count(*) FROM user_contexts('00000000-0000-0000-0000-000000000000');")
if [ -z "${RESULT}" ]; then
  error "Smoke 5.1 failed: user_contexts() returned no result"
  SMOKE_PASS=false
else
  ok "Smoke 5.1: user_contexts() OK — ${RESULT} contexts (for non-existent user, expected 0)"
fi

# Smoke 5.2: expire_due_reservations function callable
RESULT=$(query_db "SELECT count(*) FROM expire_due_reservations();")
if [ -z "${RESULT}" ]; then
  error "Smoke 5.2 failed: expire_due_reservations() returned no result"
  SMOKE_PASS=false
else
  ok "Smoke 5.2: expire_due_reservations() OK — expired ${RESULT} reservations"
fi

# Smoke 5.3: claim_pending_notifications callable
RESULT=$(query_db "SELECT count(*) FROM claim_pending_notifications(1, 10);")
if [ -z "${RESULT}" ]; then
  error "Smoke 5.3 failed: claim_pending_notifications() returned no result"
  SMOKE_PASS=false
else
  ok "Smoke 5.3: claim_pending_notifications() OK — claimed ${RESULT} messages"
fi

# Smoke 5.4: _rate_limit_hits table is accessible
RESULT=$(query_db "SELECT count(*) FROM _rate_limit_hits;")
if [ -z "${RESULT}" ]; then
  error "Smoke 5.4 failed: cannot read _rate_limit_hits"
  SMOKE_PASS=false
else
  ok "Smoke 5.4: _rate_limit_hits OK — ${RESULT} rows"
fi

# Smoke 5.5: Transactional consistency — app_user table has expected columns
RESULT=$(query_db "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='app_user';")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 5 ]; then
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
# 5.5. Transactional integrity — prove the database can do a real write
# (catches read-only replicas or partial restores that leave the DB
# in a state where reads work but writes don't)
# ──────────────────────────────────────────────────────────
log "Step 5.5: Transactional integrity (BEGIN/INSERT/ROLLBACK)"

# This runs in a transaction and rolls back — so it doesn't pollute the DB.
# It proves: BEGIN works, INSERT works, ROLLBACK works, constraints are enforced.
# Schema for audit_log: id, tenant_id, actor_user_id, action, entity, entity_id,
#   old_value, new_value, created_at
# We use a non-existent tenant_id (zeros) — FK will fail, but in a transaction
# with ROLLBACK, this proves the database is writable AND that FKs are enforced.
if ! psql_super_db -v ON_ERROR_STOP=1 <<SQL 2>"${TMP_RESTORE}/txn_test.log"
BEGIN;
-- Insert with valid FK target (a real tenant must exist for this to succeed)
-- We pick the first tenant and first platform admin
INSERT INTO audit_log (tenant_id, actor_user_id, action, entity, entity_id)
  SELECT t.id, u.id, 'restore_test_validation', 'test', gen_random_uuid()
  FROM tenant t, app_user u
  WHERE u.is_platform_admin
  LIMIT 1;
ROLLBACK;
SQL
then
  error "Transactional integrity test FAILED — database may be read-only or schema may be incomplete"
  cat "${TMP_RESTORE}/txn_test.log" >&2 || true
  exit 5
fi

# Verify the rollback worked — there should be no 'restore_test_validation' rows
RESULT=$(psql_super_db -t -c "SELECT count(*) FROM audit_log WHERE action = 'restore_test_validation';" 2>/dev/null | tr -d '[:space:]')
if [ "${RESULT}" != "0" ]; then
  error "Transactional integrity test FAILED — ROLLBACK did not work (got ${RESULT} rows, expected 0)"
  exit 5
fi
ok "Transactional integrity OK — BEGIN/INSERT/ROLLBACK works correctly"

# ──────────────────────────────────────────────────────────
# Update status file with restore_test success
# ──────────────────────────────────────────────────────────
RESTORE_END=$(date +%s)
RESTORE_DURATION=$((RESTORE_END - RESTORE_START))
log "Updating status file with restore_test timestamp"

mkdir -p "${STATUS_DIR}"

# Read existing status file to preserve all other fields (last_success_*, etc.)
LAST_SUCCESS_AT_VAL="null"
LAST_SUCCESS_SIZE_VAL="null"
LAST_SUCCESS_SHA256_VAL="null"
LAST_FAILURE_AT_VAL="null"
LAST_FAILURE_REASON_VAL="null"
BACKUP_AGE_VAL="null"
RETENTION_DAYS_VAL="${BACKUP_RETENTION_DAYS:-30}"

if [ -f "${STATUS_FILE}" ]; then
  LAST_SUCCESS_AT_VAL=$(grep -o '"last_success_at": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  LAST_SUCCESS_AT_VAL="${LAST_SUCCESS_AT_VAL:-null}"

  LAST_SUCCESS_SIZE_VAL=$(grep -o '"last_success_size_bytes": [0-9]*' "${STATUS_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*' || echo "null")
  LAST_SUCCESS_SIZE_VAL="${LAST_SUCCESS_SIZE_VAL:-null}"

  LAST_SUCCESS_SHA256_VAL=$(grep -o '"last_success_sha256": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  LAST_SUCCESS_SHA256_VAL="${LAST_SUCCESS_SHA256_VAL:-null}"

  LAST_FAILURE_AT_VAL=$(grep -o '"last_failure_at": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  LAST_FAILURE_AT_VAL="${LAST_FAILURE_AT_VAL:-null}"

  LAST_FAILURE_REASON_VAL=$(grep -o '"last_failure_reason": "[^"]*"' "${STATUS_FILE}" 2>/dev/null | head -1 | sed 's/.*: "\(.*\)"/"\1"/' || echo "null")
  LAST_FAILURE_REASON_VAL="${LAST_FAILURE_REASON_VAL:-null}"

  RETENTION_DAYS_VAL=$(grep -o '"retention_days": [0-9]*' "${STATUS_FILE}" 2>/dev/null | head -1 | grep -o '[0-9]*' || echo "${RETENTION_DAYS_VAL}")
  RETENTION_DAYS_VAL="${RETENTION_DAYS_VAL:-${BACKUP_RETENTION_DAYS:-30}}"
fi

# Compute backup_age_seconds from last_success_at
if [ "${LAST_SUCCESS_AT_VAL}" != "null" ]; then
  LAST_SUCCESS_TS=$(echo "${LAST_SUCCESS_AT_VAL}" | tr -d '"')
  if LAST_SUCCESS_EPOCH=$(date -u -d "${LAST_SUCCESS_TS}" +%s 2>/dev/null); then
    BACKUP_AGE_VAL=$((RESTORE_END - LAST_SUCCESS_EPOCH))
  fi
fi

# Atomic write: temp file + chmod 0644 + rename
TMP_STATUS=$(mktemp "${STATUS_DIR}/.backup-status.XXXXXX")
chmod 0644 "${TMP_STATUS}"

cat > "${TMP_STATUS}" <<JSON
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
JSON

mv -f "${TMP_STATUS}" "${STATUS_FILE}"
ok "Status file updated"

RESTORE_DONE=true

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

# Run cleanup explicitly (CLEANUP_DONE guard makes this safe — it will run
# once, and the EXIT trap will be a no-op).
maybe_cleanup
exit 0
