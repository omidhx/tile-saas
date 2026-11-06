#!/bin/bash
# =============================================================================
# scripts/ci-backup-script-test.sh — خودِ backup-db.sh را اجرا می‌کند
# =============================================================================
# ci-backup-test.sh منطق را جدا بازنویسی کرده و backup-db.sh را صدا نمی‌زند. این اسکریپت
# فایلی را تست می‌کند که production اجرا می‌کند: docker با یک shim عوض می‌شود که pg_dump را
# مستقیم اجرا کند، و نتیجه واقعاً باز و restore می‌شود. کپی اسکریپت در پوشه‌ی موقت اجرا می‌شود
# تا backups/ واقعی پروژه هرگز دست نخورد، حتی اگر کسی این را روی سرور اجرا کند.
#
# نیاز: TEST_ADMIN_DATABASE_URL (superuser)، psql، pg_dump، pg_restore، gpg، zstd، flock.
# =============================================================================
set -euo pipefail

: "${TEST_ADMIN_DATABASE_URL:?TEST_ADMIN_DATABASE_URL is required}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
export PGPASSWORD PGHOST PGPORT

# تجزیه‌ی URL: postgres://user:pass@host:port/db
rest="${TEST_ADMIN_DATABASE_URL#*://}"
ADMIN_USER="${rest%%:*}"
rest="${rest#*:}"
PGPASSWORD="${rest%%@*}"
rest="${rest#*@}"
PGHOST="${rest%%:*}"
rest="${rest#*:}"
PGPORT="${rest%%/*}"

DB=tile_backup_script_test
RESTORED=tile_backup_script_restored_test
PASSPHRASE=ci-only-passphrase-not-a-secret
psql_admin() { psql -v ON_ERROR_STOP=1 -q -U "$ADMIN_USER" "$@"; }

cleanup() {
  psql_admin -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "DROP DATABASE IF EXISTS $RESTORED WITH (FORCE)"
  rm -rf "$TMP"
}
trap cleanup EXIT

psql_admin -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB"
psql_admin -d "$DB" -f "$ROOT/db/schema.sql" >/dev/null
psql_admin -d "$DB" -c "INSERT INTO tenant (id,name,slug) VALUES ('11111111-1111-1111-1111-111111111111','Marker','marker')"

mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'SHIM'
#!/bin/bash
# docker compose -f FILE ps postgres | docker compose -f FILE exec -T -e X postgres CMD...
# argv ثبت می‌شود: رمز نباید در خطِ فرمانِ docker باشد، چون در ps دیده می‌شود.
printf '%s\n' "$*" >> "$DOCKER_ARGV_LOG"
case "$4" in
  ps) echo postgres; exit 0 ;;
  exec) shift 4; while [ "$1" != "postgres" ]; do shift; done; shift; exec "$@" ;;
esac
exit 1
SHIM
chmod +x "$TMP/bin/docker"

mkdir -p "$TMP/project"
cp -r "$ROOT/scripts" "$TMP/project/scripts"

PATH="$TMP/bin:$PATH" \
  POSTGRES_USER="$ADMIN_USER" POSTGRES_DB="$DB" POSTGRES_PASSWORD="$PGPASSWORD" \
  BACKUP_GPG_PASSPHRASE="$PASSPHRASE" BACKUP_LOCK_FILE="$TMP/lock" DOCKER_ARGV_LOG="$TMP/argv" \
  bash "$TMP/project/scripts/backup-db.sh"

# رمزِ CI کوتاه است ("pw")؛ جست‌وجوی خودِ مقدار در مسیرها هم پیدا می‌شد، پس الگوی انتقالش را می‌گردیم.
if grep -q 'PGPASSWORD=' "$TMP/argv"; then
  echo "FAIL: رمزِ Postgres در argvِ docker است و در ps دیده می‌شود" >&2; exit 1
fi

BACKUP="$(ls -t "$TMP"/project/backups/daily/*.gpg | head -1)"

mode="$(stat -c %a "$BACKUP")"
if [ "$mode" != "600" ]; then echo "FAIL: بکاپ باید 600 باشد، شد $mode" >&2; exit 1; fi
mode="$(stat -c %a "$BACKUP.sha256")"
if [ "$mode" != "600" ]; then echo "FAIL: checksum باید 600 باشد، شد $mode" >&2; exit 1; fi

# بدون passphrase درست نباید باز شود
if echo wrong-passphrase | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --decrypt "$BACKUP" >/dev/null 2>&1; then
  echo "FAIL: بکاپ با passphrase اشتباه باز شد" >&2; exit 1
fi

echo "$PASSPHRASE" | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 --decrypt "$BACKUP" 2>/dev/null \
  | zstd -d > "$TMP/dump"
psql_admin -d postgres -c "DROP DATABASE IF EXISTS $RESTORED WITH (FORCE)" -c "CREATE DATABASE $RESTORED"
pg_restore -U "$ADMIN_USER" -d "$RESTORED" --no-owner --no-privileges --exit-on-error "$TMP/dump"

marker="$(psql_admin -d "$RESTORED" -At -c "SELECT count(*) FROM tenant WHERE slug = 'marker'")"
if [ "$marker" != "1" ]; then echo "FAIL: داده‌ی نشانه بعد از restore نیست" >&2; exit 1; fi
rls="$(psql_admin -d "$RESTORED" -At -c "SELECT count(*) FROM pg_class WHERE relname = 'product' AND relrowsecurity AND relforcerowsecurity")"
if [ "$rls" != "1" ]; then echo "FAIL: RLS بعد از restore برنگشت" >&2; exit 1; fi

echo "OK: backup-db.sh → decrypt → restore → marker و RLS سالم"
