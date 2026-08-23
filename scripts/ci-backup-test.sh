#!/bin/bash
# =============================================================================
# scripts/ci-backup-test.sh — CI-only test: full backup → verify → restore
# =============================================================================
# این اسکریپت فقط در محیطِ CI اجرا می‌شود. فرقش با `backup-db.sh`:
#   - به‌جایِ `docker compose exec postgres` از `pg_dump`/`psql` مستقیم روی host
#     استفاده می‌کند (در GitHub Actions، postgres به‌صورتِ service container روی
#     localhost:5432 در دسترس است)
#   - فرض می‌کند postgres از قبل schema شده (Migration step قبلی در CI)
#   - بعد از تست، دیتابیسِ موقتِ `tile_restore_test` را drop می‌کند
#
# ⚠️  این اسکریپت در محیطِ production استفاده نشود — فقط CI.
#     در production از `scripts/backup-db.sh` و `scripts/restore-db.sh` استفاده کنید.
#
# ──────────────────────────────────────────────────────────
# محدودیتِ تست CI — مهم برایِ production-readiness assessment
# ──────────────────────────────────────────────────────────
# این اسکریپت منطقِ backup/verify/restore را در محیطِ host PostgreSQL تست
# می‌کند (GitHub Actions service container). این تستِ خوبی برایِ sanity است،
# ولی در چند مورد با محیطِ production فرق دارد:
#
#   ۱. Docker Compose: production از `docker compose exec -T postgres` استفاده
#      می‌کند تا pg_dump را داخلِ container اجرا کند. CI از pg_dump روی host.
#      اگر کسی در Dockerfile یا docker-compose.yml تغییری داده باشد که pg_dump
#      را در container خراب کند، CI آن را نمی‌بیند.
#
#   ۲. Volume mounts: production `./backups/status:/app/backups-status:ro` را
#      mount می‌کند. CI این mount را ندارد — status file روی filesystemِ runner
#      نوشته می‌شود.
#
#   ۳. Off-site rsync: CI هرگز `BACKUP_OFFSITE_TARGET` را ست نمی‌کند. مسیرِ
#      rsync در production باید جداگانه روی staging/VPS تست شود.
#
#   ۴. Cron و signal handling: CI فقط یک‌بار اجرا می‌شود. رفتار cron در
#      زمانِ SIGTERM (مثلاً وقتی cron kill می‌فرستد تا job بعدی شروع شود)
#      باید روی staging/VPS تست شود.
#
# بنابراین: CI سبز بودن necessary است ولی sufficient نیست. قبل از go-live،
# چرخه‌ی واقعی روی staging/VPS هم باید اجرا و verify شود.
# ──────────────────────────────────────────────────────────
#
# Exit codes:
#   0 — تمامِ مراحل موفق
#   1 — خطای pg_dump / compress / encrypt
#   2 — خطای verify
#   3 — خطای restore
#   4 — خطای integrity check
#   5 — خطای smoke query
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
# Concurrency guard — flock (same pattern as backup-db.sh)
# ──────────────────────────────────────────────────────────
LOCK_FILE="${BACKUP_LOCK_FILE:-/tmp/tile-saas-ci-backup-test.lock}"
exec 200>"${LOCK_FILE}"
if ! flock -n 200; then
  echo "ERROR: another ci-backup-test.sh is already running (lock: ${LOCK_FILE})" >&2
  exit 1
fi

# Test hook — sleep after acquiring flock, for deterministic concurrency tests.
# ⚠️ ONLY FOR TESTING. Requires both BACKUP_TEST_MODE=1 AND BACKUP_TEST_HOLD_SECONDS=N.
# این sleep قبل ازِ require_command قرار دارد تا تست flock بدونِ interference
# از سمتِ command checks انجام شود. pre-flight checks عمداً به تأخیر می‌افتند.
BACKUP_TEST_MODE="${BACKUP_TEST_MODE:-0}"

if [ "${BACKUP_TEST_MODE}" = "1" ] && [ -n "${BACKUP_TEST_HOLD_SECONDS:-}" ]; then
  # Validate: must be a non-negative number
  if ! [[ "${BACKUP_TEST_HOLD_SECONDS}" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "ERROR: BACKUP_TEST_HOLD_SECONDS must be a non-negative number (got: '${BACKUP_TEST_HOLD_SECONDS}')" >&2
    exit 1
  fi

  # Cap at 300 seconds
  local_hold_int="${BACKUP_TEST_HOLD_SECONDS%.*}"
  if [ "${local_hold_int}" -gt 300 ] 2>/dev/null; then
    echo "ERROR: BACKUP_TEST_HOLD_SECONDS exceeds 300 second cap (got: ${BACKUP_TEST_HOLD_SECONDS})" >&2
    exit 1
  fi

  echo "TEST MODE: holding lock for ${BACKUP_TEST_HOLD_SECONDS} seconds" >&2
  echo "TEST MODE: pre-flight checks are DELIBERATELY delayed — NOT for production" >&2
  sleep "${BACKUP_TEST_HOLD_SECONDS}"
fi

# ──────────────────────────────────────────────────────────
# Logging
# ──────────────────────────────────────────────────────────
log()   { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] INFO  $*"; }
warn()  { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] WARN  $*"; }
error() { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] ERROR $*" >&2; }
ok()    { echo -e "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] OK    $*"; }

# ──────────────────────────────────────────────────────────
# Configuration — all from env (CI sets these)
# ──────────────────────────────────────────────────────────
POSTGRES_HOST="${POSTGRES_HOST:-localhost}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_USER="${POSTGRES_USER:?POSTGRES_USER is required}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
POSTGRES_DB="${POSTGRES_DB:?POSTGRES_DB is required}"

BACKUP_GPG_PASSPHRASE="${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE is required}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

# CI-only: never use BACKUP_OFFSITE_TARGET (no remote storage in CI)
BACKUP_OFFSITE_TARGET=""
BACKUP_OFFSITE_METHOD="rsync"

# Restore test DB name — must be safe identifier and must not equal POSTGRES_DB
RESTORE_DB_NAME="${RESTORE_DB_NAME:-tile_restore_test}"
if [ "${RESTORE_DB_NAME}" = "${POSTGRES_DB}" ]; then
  echo "ERROR: RESTORE_DB_NAME must not equal POSTGRES_DB" >&2
  exit 1
fi
if ! [[ "${RESTORE_DB_NAME}" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "ERROR: RESTORE_DB_NAME contains invalid characters: '${RESTORE_DB_NAME}'" >&2
  exit 1
fi

# Project paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/backups/daily"
STATUS_DIR="${PROJECT_ROOT}/backups/status"
STATUS_FILE="${STATUS_DIR}/backup-status.json"

# Temporary directory for intermediate files
TMP_DIR=$(mktemp -d)
chmod 700 "${TMP_DIR}"

# Cleanup function — with double-cleanup guard (called on exit, signal, error)
#
# CLEANUP_DONE جلویِ اجرایِ دوباره را می‌گیرد. وقتی Ctrl+C می‌زنیم:
#   ۱. INT handler اجرا می‌شود → cleanup + exit 130
#   ۲. EXIT trap اجرا می‌شود (به‌خاطرِ exit) → cleanup دوباره — مگر guard داشته باشیم
CLEANUP_DONE=0
cleanup() {
  if [ "${CLEANUP_DONE}" -eq 1 ]; then
    return 0
  fi
  CLEANUP_DONE=1

  # Clean up intermediate files
  rm -f "${BACKUP_FILE_RAW:-}" 2>/dev/null || true
  rm -f "${BACKUP_FILE_ZST:-}" 2>/dev/null || true

  if [ -n "${TMP_DIR:-}" ] && [ -d "${TMP_DIR}" ]; then
    rm -rf "${TMP_DIR}" 2>/dev/null || true
  fi

  # Drop the temporary restore test database.
  # Try `WITH (FORCE)` first (PG13+ atomic), fall back to two-step.
  # Reference: https://www.postgresql.org/docs/16/sql-dropdatabase.html
  if [ -n "${RESTORE_DB_NAME:-}" ]; then
    if ! PGPASSWORD="${POSTGRES_PASSWORD}" psql \
      -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
      -d postgres -c "DROP DATABASE IF EXISTS \"${RESTORE_DB_NAME}\" WITH (FORCE);" 2>/dev/null; then
      # Fallback for older PostgreSQL: terminate + drop
      PGPASSWORD="${POSTGRES_PASSWORD}" psql \
        -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
        -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${RESTORE_DB_NAME}' AND pid <> pg_backend_pid();" \
        2>/dev/null || true
      PGPASSWORD="${POSTGRES_PASSWORD}" psql \
        -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
        -d postgres -c "DROP DATABASE IF EXISTS \"${RESTORE_DB_NAME}\";" 2>/dev/null || true
    fi
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
# Helpers
# ──────────────────────────────────────────────────────────
psql_db() {
  # Run a SQL command against the restore test DB
  PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
    -d "${RESTORE_DB_NAME}" -v ON_ERROR_STOP=1 -t -c "$1" 2>/dev/null | tr -d '[:space:]'
}

psql_admin() {
  # Run a SQL command against the postgres (admin) DB
  PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
    -d postgres -v ON_ERROR_STOP=1 "$@"
}

# ──────────────────────────────────────────────────────────
# Pre-flight
# ──────────────────────────────────────────────────────────
log "=== Phase 8: Backup → Verify → Restore test (CI) ==="
log "Target: ${POSTGRES_USER}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
log "Restore target: ${RESTORE_DB_NAME}"

# Required commands — fail loud if any are missing
# flock is needed for the concurrency guard (used at the top of this script)
require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "Required command not found: $1"
    error "On Ubuntu/Debian: sudo apt-get install -y util-linux postgresql-client zstd gnupg"
    exit 127
  fi
}
for cmd in pg_dump psql pg_restore gpg zstd flock; do
  require_command "$cmd"
done

mkdir -p "${BACKUP_DIR}" "${STATUS_DIR}"

# ──────────────────────────────────────────────────────────
# Step 0: Re-apply migrations (test suite resets schema, wiping _migrations data)
# ──────────────────────────────────────────────────────────
# The test suite (web/src/db/_testdb.ts resetSchema) does DROP SCHEMA + recreates
# from schema.sql. schema.sql creates the _migrations table but does NOT populate
# it — that's apply.ts's job. So after tests, _migrations exists but is empty.
#
# In production, apply.ts runs at deploy time and populates _migrations. To make
# the CI backup test realistic, we re-run apply.ts here so the backup captures
# a realistic state (with migration history).
#
# We also seed a minimal tenant + platform admin if none exist, because the
# integrity checks (4.4, 4.5) expect at least 1 tenant and 1 platform admin.
#
# Note: we do NOT re-run schema.sql here because it uses CREATE TABLE (not
# CREATE TABLE IF NOT EXISTS for all tables) and would fail with "relation
# already exists". apply.ts is idempotent and safe to re-run.
log "--- Step 0/9: Re-apply migrations + seed minimal data ---"

# Run apply.ts to populate _migrations table (needs node + tsx from web/)
# NODE_PATH is needed because apply.ts is in db/migrations/ but node_modules is in web/
if [ -f "${PROJECT_ROOT}/db/migrations/apply.ts" ]; then
  cd "${PROJECT_ROOT}/web"
  DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}" \
    AUTH_SECRET="ci-secret-must-be-at-least-32-characters-long-for-tests-only" \
    NODE_PATH="${PROJECT_ROOT}/web/node_modules" \
    node --import tsx "${PROJECT_ROOT}/db/migrations/apply.ts" \
    2>"${TMP_DIR}/migrations_apply.log" || {
    error "apply.ts failed"
    cat "${TMP_DIR}/migrations_apply.log" >&2
    exit 1
  }
  cd "${PROJECT_ROOT}"
  ok "Migrations re-applied"
else
  warn "apply.ts not found — skipping migration re-apply (migrations table may be empty)"
fi

# Seed minimal data: at least 1 tenant + 1 platform admin (if none exist)
# This is needed because the integrity checks expect them.
# Note: app_user.phone (not mobile), app_user.password_hash is NOT NULL
# We use a dummy bcrypt hash for the test admin (never used for login)
SEED_SQL="
-- Insert a test tenant if none exists
INSERT INTO tenant (id, name, slug, created_at)
SELECT '11111111-1111-1111-1111-111111111111', 'Test Tenant', 'test-tenant', now()
WHERE NOT EXISTS (SELECT 1 FROM tenant);

-- Insert a platform admin user if none exists
-- password_hash is a dummy bcrypt hash (test-only, never used for real login)
INSERT INTO app_user (id, phone, password_hash, is_platform_admin, created_at)
SELECT '11111111-1111-1111-1111-111111111112', '09999999999',
       '\$2a\$10\$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, now()
WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE is_platform_admin);

-- Link admin to tenant (tenant_membership has no created_at column)
INSERT INTO tenant_membership (tenant_id, user_id, role, is_active)
SELECT '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111112', 'admin', true
WHERE NOT EXISTS (SELECT 1 FROM tenant_membership);
"

PGPASSWORD="${POSTGRES_PASSWORD}" psql \
  -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" -v ON_ERROR_STOP=1 -c "${SEED_SQL}" \
  2>"${TMP_DIR}/seed.log" || {
  warn "Seed data insertion had issues (may be OK if data already exists)"
  cat "${TMP_DIR}/seed.log" >&2 || true
}
ok "Minimal data verified"

# ──────────────────────────────────────────────────────────
# Step 1: pg_dump (direct, host postgres — no docker compose)
# ──────────────────────────────────────────────────────────
log "--- Step 1/9: pg_dump (custom format) ---"

STAMP="$(date -u +%Y-%m-%d_%H%M)"
DATE_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
BACKUP_NAME="tile_saas_${STAMP}"
BACKUP_FILE_RAW="${BACKUP_DIR}/${BACKUP_NAME}.sql"
BACKUP_FILE_ZST="${BACKUP_DIR}/${BACKUP_NAME}.sql.zst"
BACKUP_FILE_GPG="${BACKUP_DIR}/${BACKUP_NAME}.sql.zstd.gpg"

# pipefail ensures that if pg_dump fails, the redirect exit code propagates
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --verbose \
  > "${BACKUP_FILE_RAW}" 2>"${TMP_DIR}/pg_dump.log"

RAW_SIZE=$(stat -c%s "${BACKUP_FILE_RAW}")
if [ "${RAW_SIZE}" -lt 1024 ]; then
  error "pg_dump produced a file smaller than 1KB (${RAW_SIZE} bytes)"
  cat "${TMP_DIR}/pg_dump.log" >&2 || true
  exit 1
fi
ok "pg_dump OK — raw size: ${RAW_SIZE} bytes"

# ──────────────────────────────────────────────────────────
# Step 2: zstd compress
# ──────────────────────────────────────────────────────────
log "--- Step 2/9: zstd compression ---"
zstd -q -19 -f -o "${BACKUP_FILE_ZST}" "${BACKUP_FILE_RAW}"
ZST_SIZE=$(stat -c%s "${BACKUP_FILE_ZST}")
if [ "${ZST_SIZE}" -lt 100 ]; then
  error "zstd compression produced an empty file"
  exit 1
fi
ok "zstd OK — ${ZST_SIZE} bytes"

# Clean up raw dump (unencrypted)
rm -f "${BACKUP_FILE_RAW}"

# ──────────────────────────────────────────────────────────
# Step 3: GPG encrypt (same flags as backup-db.sh)
# ──────────────────────────────────────────────────────────
log "--- Step 3/9: GPG symmetric encryption (AES-256) ---"
echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --symmetric --cipher-algo AES256 --compress-algo none \
  --s2k-digest-algo SHA512 --s2k-count 65011712 \
  --output "${BACKUP_FILE_GPG}" "${BACKUP_FILE_ZST}" \
  2>"${TMP_DIR}/gpg_encrypt.log"

GPG_EXIT=$?
if [ ${GPG_EXIT} -ne 0 ] || [ ! -s "${BACKUP_FILE_GPG}" ]; then
  error "GPG encryption failed (exit ${GPG_EXIT})"
  cat "${TMP_DIR}/gpg_encrypt.log" >&2 || true
  exit 1
fi
GPG_SIZE=$(stat -c%s "${BACKUP_FILE_GPG}")
chmod 600 "${BACKUP_FILE_GPG}"
ok "GPG OK — ${GPG_SIZE} bytes"

# Clean up compressed file (unencrypted)
rm -f "${BACKUP_FILE_ZST}"

# ──────────────────────────────────────────────────────────
# Step 4: SHA-256 checksum
# ──────────────────────────────────────────────────────────
log "--- Step 4/9: SHA-256 checksum ---"
SHA256=$(sha256sum "${BACKUP_FILE_GPG}" | awk '{print $1}')
echo "${SHA256}  ${BACKUP_FILE_GPG}" > "${BACKUP_FILE_GPG}.sha256"
chmod 600 "${BACKUP_FILE_GPG}.sha256"
ok "SHA-256: ${SHA256}"

# ──────────────────────────────────────────────────────────
# Step 5: Verify (decrypt + check PGDMP magic + pg_restore --list)
# ──────────────────────────────────────────────────────────
log "--- Step 5/9: Verify (decrypt + format + pg_restore --list) ---"

# Decrypt + decompress
# pipefail is set, so if gpg or zstd fails, the whole pipeline fails
if ! echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt "${BACKUP_FILE_GPG}" 2>"${TMP_DIR}/gpg_decrypt.log" \
  | zstd -d 2>"${TMP_DIR}/zstd_decompress.log" \
  > "${TMP_DIR}/verify.sql"; then
  error "Decrypt/decompress failed"
  cat "${TMP_DIR}/gpg_decrypt.log" >&2 || true
  cat "${TMP_DIR}/zstd_decompress.log" >&2 || true
  exit 2
fi

if [ ! -s "${TMP_DIR}/verify.sql" ]; then
  error "Decrypted file is empty"
  exit 2
fi

MAGIC=$(head -c 5 "${TMP_DIR}/verify.sql")
if [ "${MAGIC}" != "PGDMP" ]; then
  error "Not a valid pg_dump format (expected 'PGDMP', got '${MAGIC}')"
  exit 2
fi
ok "PGDMP magic OK"

# pg_restore --list to validate schema integrity
TABLE_COUNT=$(pg_restore --list "${TMP_DIR}/verify.sql" 2>/dev/null | grep -c "; " || echo "0")
if [ "${TABLE_COUNT}" -lt 10 ]; then
  error "pg_restore --list returned too few entries (${TABLE_COUNT})"
  exit 2
fi
ok "pg_restore --list: ${TABLE_COUNT} entries"

# ──────────────────────────────────────────────────────────
# Step 6: Restore to temporary database
# ──────────────────────────────────────────────────────────
log "--- Step 6/9: Restore to '${RESTORE_DB_NAME}' (TEMPORARY) ---"

# Disconnect any lingering sessions
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${RESTORE_DB_NAME}' AND pid <> pg_backend_pid();" 2>/dev/null || true

# Drop + recreate
psql_admin -c "DROP DATABASE IF EXISTS \"${RESTORE_DB_NAME}\";"
psql_admin -c "CREATE DATABASE \"${RESTORE_DB_NAME}\";"
ok "Database '${RESTORE_DB_NAME}' recreated"

# pg_restore
if ! PGPASSWORD="${POSTGRES_PASSWORD}" pg_restore \
  -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
  -d "${RESTORE_DB_NAME}" \
  --no-owner --no-privileges --exit-on-error \
  "${TMP_DIR}/verify.sql" 2>"${TMP_DIR}/pg_restore.log"; then
  error "pg_restore failed"
  cat "${TMP_DIR}/pg_restore.log" >&2 || true
  exit 3
fi
ok "pg_restore OK"

# Clean up the dump file (no longer needed)
rm -f "${TMP_DIR}/verify.sql"

# ──────────────────────────────────────────────────────────
# Step 7: Integrity checks
# ──────────────────────────────────────────────────────────
log "--- Step 7/9: Integrity checks ---"

# 7.1 SELECT 1
RESULT=$(psql_db "SELECT 1;")
if [ "${RESULT}" != "1" ]; then
  error "Check 7.1 failed: SELECT 1 returned '${RESULT}'"
  exit 4
fi
ok "7.1 SELECT 1 OK"

# 7.2 Table count (≥ 38 per schema.sql)
RESULT=$(psql_db "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 38 ]; then
  error "Check 7.2 failed: Expected ≥ 38 tables, got '${RESULT}'"
  exit 4
fi
ok "7.2 Table count OK — ${RESULT}"

# 7.3 Migrations table populated
RESULT=$(psql_db "SELECT count(*) FROM _migrations;")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 3 ]; then
  error "Check 7.3 failed: Expected ≥ 3 migrations, got '${RESULT}'"
  exit 4
fi
ok "7.3 Migrations OK — ${RESULT}"

# 7.4 RLS policies present
RESULT=$(psql_db "SELECT count(*) FROM pg_policy;")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 1 ]; then
  error "Check 7.4 failed: No RLS policies found"
  exit 4
fi
ok "7.4 RLS policies OK — ${RESULT}"

# 7.5 SECURITY DEFINER functions present
RESULT=$(psql_db "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef = true;")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 4 ]; then
  error "Check 7.5 failed: Expected ≥ 4 SECURITY DEFINER functions, got '${RESULT}'"
  exit 4
fi
ok "7.5 SECURITY DEFINER functions OK — ${RESULT}"

# ──────────────────────────────────────────────────────────
# Step 8: Smoke queries
# ──────────────────────────────────────────────────────────
log "--- Step 8/9: Smoke queries ---"

# 8.1 user_contexts (SECURITY DEFINER)
RESULT=$(psql_db "SELECT count(*) FROM user_contexts('00000000-0000-0000-0000-000000000000');")
if [ -z "${RESULT}" ]; then
  error "Smoke 8.1 failed: user_contexts() returned no result"
  exit 5
fi
ok "8.1 user_contexts() OK — ${RESULT} contexts"

# 8.2 expire_due_reservations
RESULT=$(psql_db "SELECT count(*) FROM expire_due_reservations();")
if [ -z "${RESULT}" ]; then
  error "Smoke 8.2 failed: expire_due_reservations() returned no result"
  exit 5
fi
ok "8.2 expire_due_reservations() OK — expired ${RESULT}"

# 8.3 claim_pending_notifications
RESULT=$(psql_db "SELECT count(*) FROM claim_pending_notifications(1, 10);")
if [ -z "${RESULT}" ]; then
  error "Smoke 8.3 failed: claim_pending_notifications() returned no result"
  exit 5
fi
ok "8.3 claim_pending_notifications() OK — claimed ${RESULT}"

# 8.4 _rate_limit_hits accessible
RESULT=$(psql_db "SELECT count(*) FROM _rate_limit_hits;")
if [ -z "${RESULT}" ]; then
  error "Smoke 8.4 failed: _rate_limit_hits not accessible"
  exit 5
fi
ok "8.4 _rate_limit_hits OK — ${RESULT} rows"

# 8.5 app_user table has expected columns
RESULT=$(psql_db "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='app_user';")
if ! [[ "${RESULT}" =~ ^[0-9]+$ ]] || [ "${RESULT}" -lt 5 ]; then
  error "Smoke 8.5 failed: app_user table has too few columns (${RESULT})"
  exit 5
fi
ok "8.5 app_user schema OK — ${RESULT} columns"

# 8.6 Row counts for key tables (informational — catches partial restore)
log "8.6 Row counts for key tables:"
for table in app_user tenant audit_log product inventory_balance reservation; do
  RESULT=$(psql_db "SELECT count(*) FROM ${table};")
  if [[ "${RESULT}" =~ ^[0-9]+$ ]]; then
    log "  - ${table}: ${RESULT} rows"
  else
    error "8.6 ${table} table is not accessible (got '${RESULT}')"
    exit 5
  fi
done
ok "8.6 All key tables accessible"

# ──────────────────────────────────────────────────────────
# Step 8.5: Transactional integrity — BEGIN/INSERT/ROLLBACK
# ──────────────────────────────────────────────────────────
log "--- Step 8.5: Transactional integrity (BEGIN/INSERT/ROLLBACK) ---"

# This proves the database is writable AND transactions work correctly.
# We insert a row, then ROLLBACK — so the database state is unchanged.
# Schema: audit_log (id, tenant_id, actor_user_id, action, entity, entity_id, ...)
if ! PGPASSWORD="${POSTGRES_PASSWORD}" psql \
  -h "${POSTGRES_HOST}" -p "${POSTGRES_PORT}" -U "${POSTGRES_USER}" \
  -d "${RESTORE_DB_NAME}" -v ON_ERROR_STOP=1 <<SQL 2>"${TMP_DIR}/txn_test.log"
BEGIN;
INSERT INTO audit_log (tenant_id, actor_user_id, action, entity, entity_id)
  SELECT t.id, u.id, 'restore_test_validation', 'test', gen_random_uuid()
  FROM tenant t, app_user u
  WHERE u.is_platform_admin
  LIMIT 1;
ROLLBACK;
SQL
then
  error "Transactional integrity test FAILED"
  cat "${TMP_DIR}/txn_test.log" >&2 || true
  exit 5
fi

# Verify ROLLBACK worked — should be 0 rows with this action
RESULT=$(psql_db "SELECT count(*) FROM audit_log WHERE action = 'restore_test_validation';")
if [ "${RESULT}" != "0" ]; then
  error "Transactional integrity FAILED — ROLLBACK did not work (got ${RESULT} rows, expected 0)"
  exit 5
fi
ok "8.6 Transactional integrity OK — BEGIN/INSERT/ROLLBACK works"

# ──────────────────────────────────────────────────────────
# Step 9: Write status file (atomic + 0644)
# ──────────────────────────────────────────────────────────
log "--- Step 9/9: Write backup-status.json ---"

TMP_STATUS=$(mktemp "${STATUS_DIR}/.backup-status.XXXXXX")
chmod 0644 "${TMP_STATUS}"

cat > "${TMP_STATUS}" <<JSON
{
  "last_success_at": "${DATE_ISO}",
  "last_failure_at": null,
  "last_failure_reason": null,
  "last_success_size_bytes": ${GPG_SIZE},
  "last_success_sha256": "${SHA256}",
  "backup_age_seconds": 0,
  "restore_test_last_success_at": "${DATE_ISO}",
  "restore_test_last_failure_at": null,
  "retention_days": ${BACKUP_RETENTION_DAYS}
}
JSON

mv -f "${TMP_STATUS}" "${STATUS_FILE}"
ok "Status file written"

# ──────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────
ok ""
ok "═══════════ Phase 8 CI Test Summary ═══════════"
ok "Backup file: ${BACKUP_FILE_GPG}"
ok "Size: ${GPG_SIZE} bytes"
ok "SHA-256: ${SHA256:0:32}..."
ok "All 9 steps PASSED"
ok ""
ok "=== Phase 8: Backup → Verify → Restore test PASSED ==="

# Cleanup happens via trap on EXIT
exit 0
