#!/bin/bash
# بازیابی واقعی روی همین سرور. (restore-db.sh و restore-uploads.sh فقط آزمایشی‌اند و داده‌ی اصلی را لمس نمی‌کنند.)
#
#   bash scripts/restore-prod.sh --overwrite-production <بکاپ دیتابیس .gpg> [<بکاپ آپلودها .gpg>]
#
# بکاپ قبل از توقف سایت کامل باز و بررسی می‌شود؛ بکاپ خراب یا رمز اشتباه سایت را از کار نمی‌اندازد.
# دیتابیس فعلی پاک نمی‌شود: نسخه‌ی تازه کنارش ساخته می‌شود و قبلی با نام <db>_before_restore_<زمان> می‌ماند.
# نیاز: همان .env (BACKUP_GPG_PASSPHRASE و AUTH_SECRET)، gpg، zstd.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" != "--overwrite-production" ] || [ -z "${2:-}" ]; then
  sed -n 2,8p "${BASH_SOURCE[0]}" | sed 's/^# \?//'
  exit 1
fi
DB_BACKUP="$2"
UPLOADS_BACKUP="${3:-}"

set -a
# shellcheck disable=SC1091
source "${ROOT}/.env"
set +a
POSTGRES_USER="${POSTGRES_USER:-postgres}"
POSTGRES_DB="${POSTGRES_DB:-tile_saas}"
: "${BACKUP_GPG_PASSPHRASE:?BACKUP_GPG_PASSPHRASE در .env نیست}"

compose() { docker compose -f "${ROOT}/docker-compose.yml" "$@"; }
psql_admin() { compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
decrypt() {
  gpg --quiet --batch --yes --pinentry-mode loopback --passphrase-fd 3 --decrypt "$1" 3<<<"$BACKUP_GPG_PASSPHRASE" | zstd -d -q
}
# مسیر داخل فایل .sha256 مسیر سرور قبلی است، پس فقط خود hash مقایسه می‌شود.
check_sha() {
  [ -f "$1.sha256" ] || { echo "ERROR: $1.sha256 پیدا نشد" >&2; exit 1; }
  [ "$(sha256sum "$1" | cut -d' ' -f1)" = "$(cut -d' ' -f1 "$1.sha256")" ] || { echo "ERROR: checksum فایل $1 نمی‌خورد" >&2; exit 1; }
}

TMP="$(mktemp -d)"
chmod 700 "$TMP"
SITE_STOPPED=false
on_exit() {
  local code=$?
  rm -rf "$TMP"
  if [ "$code" -ne 0 ] && [ "$SITE_STOPPED" = true ]; then
    echo "ERROR: بازیابی نیمه‌کاره ماند و سایت متوقف است. برای بالا آوردن با داده‌ی فعلی: docker compose up -d" >&2
  fi
}
trap on_exit EXIT

check_sha "$DB_BACKUP"
if [ -n "$UPLOADS_BACKUP" ]; then check_sha "$UPLOADS_BACKUP"; fi

echo "→ باز کردن و بررسی بکاپ، بدون دست زدن به سایت"
compose up -d --wait postgres
decrypt "$DB_BACKUP" >"$TMP/db.dump"
[ "$(head -c 5 "$TMP/db.dump")" = PGDMP ] || { echo "ERROR: $DB_BACKUP بکاپ pg_dump نیست" >&2; exit 1; }
compose exec -T postgres pg_restore --list <"$TMP/db.dump" >/dev/null
if [ -n "$UPLOADS_BACKUP" ]; then
  decrypt "$UPLOADS_BACKUP" >"$TMP/uploads.tar"
  tar -tf "$TMP/uploads.tar" >/dev/null
fi

echo "→ توقف اپ و workerها"
SITE_STOPPED=true
compose stop caddy web worker-expire worker-outbox worker-housekeeping

NEW_DB="${POSTGRES_DB}_restoring"
OLD_DB="${POSTGRES_DB}_before_restore_$(date -u +%Y%m%d%H%M%S)"
psql_admin -c "DROP DATABASE IF EXISTS \"${NEW_DB}\" WITH (FORCE)" -c "CREATE DATABASE \"${NEW_DB}\""

echo "→ بازیابی دیتابیس در ${NEW_DB}"
compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$NEW_DB" --no-owner --no-privileges --exit-on-error <"$TMP/db.dump"

echo "→ جابه‌جایی نام‌ها؛ دیتابیس قبلی: ${OLD_DB}"
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${POSTGRES_DB}', '${NEW_DB}') AND pid <> pg_backend_pid()" >/dev/null
# یک رشته‌ی -c یعنی یک تراکنش: یا هر دو نام عوض می‌شوند یا هیچ‌کدام.
psql_admin -c "ALTER DATABASE \"${POSTGRES_DB}\" RENAME TO \"${OLD_DB}\"; ALTER DATABASE \"${NEW_DB}\" RENAME TO \"${POSTGRES_DB}\""

# روی سرور تازه volume با رمز دیگری ساخته شده و .env قبلی بعداً برگشته است. اتصال داخل کانتینر رمز نمی‌خواهد.
# از stdin، نه -c، تا رمز در فهرست پروسه‌ها نیاید.
psql_admin <<<"ALTER ROLE \"${POSTGRES_USER}\" PASSWORD '${POSTGRES_PASSWORD//\'/\'\'}'"

if [ -n "$UPLOADS_BACKUP" ]; then
  echo "→ بازیابی آپلودها"
  compose run --rm --no-deps -T --entrypoint tar web -x -f - -C /app/web/private <"$TMP/uploads.tar"
fi

# بکاپ grant ندارد: migrate نقش، grantها و migrationهای جدیدتر از بکاپ را برمی‌گرداند.
echo "→ migrate و راه‌اندازی"
compose up -d
SITE_STOPPED=false
echo "✓ بازیابی تمام شد. بعد از اطمینان، دیتابیس قبلی را حذف کنید:"
echo "  docker compose exec postgres psql -U ${POSTGRES_USER} -d postgres -c 'DROP DATABASE \"${OLD_DB}\"'"
