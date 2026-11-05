#!/bin/bash
# بازیابی واقعی روی همین سرور. (restore-db.sh و restore-uploads.sh فقط آزمایشی‌اند و داده‌ی اصلی را لمس نمی‌کنند.)
#
#   bash scripts/restore-prod.sh --overwrite-production <بکاپ دیتابیس .gpg> [<بکاپ آپلودها .gpg>]
#
# دیتابیس فعلی پاک نمی‌شود: اول نسخه‌ی تازه کامل ساخته می‌شود، بعد نام‌ها جابه‌جا می‌شوند و
# قبلی با نام <db>_before_restore_<زمان> می‌ماند. اگر بکاپ خراب باشد، چیزی عوض نشده است.
# نیاز: همان .env (BACKUP_GPG_PASSPHRASE و AUTH_SECRET)، gpg، zstd.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" != "--overwrite-production" ] || [ -z "${2:-}" ]; then
  sed -n 2,7p "${BASH_SOURCE[0]}" | sed 's/^# \?//'
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

check_sha "$DB_BACKUP"
if [ -n "$UPLOADS_BACKUP" ]; then check_sha "$UPLOADS_BACKUP"; fi

echo "→ توقف اپ و workerها"
compose stop caddy web worker-expire worker-outbox worker-housekeeping
compose up -d --wait postgres

NEW_DB="${POSTGRES_DB}_restoring"
OLD_DB="${POSTGRES_DB}_before_restore_$(date -u +%Y%m%d%H%M%S)"
psql_admin -c "DROP DATABASE IF EXISTS \"${NEW_DB}\" WITH (FORCE)" -c "CREATE DATABASE \"${NEW_DB}\""

echo "→ بازیابی دیتابیس در ${NEW_DB}"
decrypt "$DB_BACKUP" | compose exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$NEW_DB" --no-owner --no-privileges --exit-on-error

echo "→ جابه‌جایی نام‌ها؛ دیتابیس قبلی: ${OLD_DB}"
# اتصال باز روی دیتابیس فعلی نباید جابه‌جایی را متوقف کند؛ اپ و workerها همین الان متوقف شده‌اند.
psql_admin -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('${POSTGRES_DB}', '${NEW_DB}') AND pid <> pg_backend_pid()"
psql_admin -c "ALTER DATABASE \"${POSTGRES_DB}\" RENAME TO \"${OLD_DB}\"" -c "ALTER DATABASE \"${NEW_DB}\" RENAME TO \"${POSTGRES_DB}\""

if [ -n "$UPLOADS_BACKUP" ]; then
  echo "→ بازیابی آپلودها"
  decrypt "$UPLOADS_BACKUP" | compose run --rm --no-deps -T --entrypoint tar web -x -f - -C /app/web/private
fi

# بکاپ grant ندارد: migrate نقش، grantها و migrationهای جدیدتر از بکاپ را برمی‌گرداند.
echo "→ migrate و راه‌اندازی"
compose up -d
echo "✓ بازیابی تمام شد. بعد از اطمینان، دیتابیس قبلی را حذف کنید: DROP DATABASE \"${OLD_DB}\""
