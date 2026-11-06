#!/bin/bash
# تست نصب تمیز با Docker: همان فایل‌هایی که روی سرور می‌روند، از صفر تا بازیابی بکاپ.
# CI روی هر PR اجرایش می‌کند؛ روی لینوکس با gpg، zstd، flock، python3، curl و openssl.
#
# در پوشه‌ی موقت و با نام پروژه‌ی جدا اجرا می‌شود، پس به .env و volumeهای واقعی دست نمی‌زند.
# پورت‌های 80 و 443 باید آزاد باشند. ایمیج tile-saas:$IMAGE_TAG اگر نباشد ساخته می‌شود.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export IMAGE_TAG="${IMAGE_TAG:-smoke}"
export COMPOSE_PROJECT_NAME=tile_smoke

WORK="$(mktemp -d)"
BASE=https://localhost
ORIGIN=(-H "Origin: ${BASE}" -H "Content-Type: application/json")
ADMIN_PHONE=09120000099
ADMIN_PASSWORD=smoke-platform-admin-pw
T=aaaaaaaa-0000-4000-8000-000000000001

compose() { docker compose -f "$WORK/docker-compose.yml" "$@"; }
q() { compose exec -T postgres psql -U postgres -d tile_saas -v ON_ERROR_STOP=1 -Atc "$1"; }
http() { curl -sk --max-time 30 "$@"; }
step() { echo; echo "=== $*"; }
pass() { echo "  ok: $*"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
expect() { # expect <توضیح> <انتظار> <مقدار>
  if [ "$2" != "$3" ]; then fail "$1: انتظار «$2»، مقدار «$3»"; fi
  pass "$1"
}
wait_for() { # wait_for <توضیح> <ثانیه> <دستور...>
  local what="$1" limit="$2" i
  shift 2
  for ((i = 0; i < limit; i += 2)); do
    if "$@" >/dev/null 2>&1; then pass "$what (${i}s)"; return 0; fi
    sleep 2
  done
  fail "$what بعد از ${limit}s نشد"
}
ready() { [ "$(http -o /dev/null -w '%{http_code}' "$BASE/api/ready")" = 200 ]; }
login() { # login <فایل کوکی> <شناسه> <رمز> ← کد HTTP
  http -o /dev/null -w '%{http_code}' -c "$1" -D "$1.headers" "${ORIGIN[@]}" -X POST "$BASE/api/auth/login" \
    -d "{\"identifier\":\"$2\",\"password\":\"$3\"}"
}
query_is() { [ "$(q "$1")" = "$2" ]; }

on_exit() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    echo; echo "=== شکست (exit $code): وضعیت و لاگ"
    compose ps -a || echo "compose ps شکست خورد"
    compose logs --tail=40 || echo "compose logs شکست خورد"
  fi
  compose down -v --remove-orphans >/dev/null 2>&1 || echo "پاکسازی کانتینرها شکست خورد"
  rm -rf "$WORK"
  exit "$code"
}
trap on_exit EXIT

step "۰. ایمیج و فایل‌های سرور"
if ! docker image inspect "tile-saas:${IMAGE_TAG}" >/dev/null 2>&1; then
  docker build -t "tile-saas:${IMAGE_TAG}" "$ROOT"
fi
docker run --rm --entrypoint sh "tile-saas:${IMAGE_TAG}" -c '
  for p in /app/web/src /app/web/e2e /app/web/.env /app/web/.env.test /app/.env /app/.claude /app/_audit /app/db/seed-dev.sql; do
    if [ -e "$p" ]; then echo "اضافه در ایمیج: $p"; exit 1; fi
  done' || fail "ایمیج فایل اضافه یا راز دارد"
pass "ایمیج src و .env و seed و .claude ندارد"
cp -r "$ROOT/docker-compose.yml" "$ROOT/Caddyfile" "$ROOT/.env.example" "$ROOT/scripts" "$ROOT/backups" "$WORK/"
mkdir -p "$WORK/backups/status" "$WORK/backups/daily" "$WORK/backups/uploads"
bash "$WORK/scripts/init-env.sh" localhost
sed -i "s|^BACKUP_OFFSITE_TARGET=.*|BACKUP_OFFSITE_TARGET=$WORK/offsite|" "$WORK/.env"
mkdir "$WORK/offsite"
if bash "$WORK/scripts/init-env.sh" localhost 2>/dev/null; then fail "init-env روی .env موجود نوشت"; fi
pass "init-env روی .env موجود نمی‌نویسد"
expect "فایل .env فقط برای مالک" 600 "$(stat -c%a "$WORK/.env")"
APP_PW="$(grep '^APP_USER_PASSWORD=' "$WORK/.env" | cut -d= -f2)"
PG_PW="$(grep '^POSTGRES_PASSWORD=' "$WORK/.env" | cut -d= -f2)"

step "۱. نصب از صفر"
compose up -d
wait_for "سایت از Caddy با HTTPS بالا آمد" 180 ready
expect "migrate موفق خارج شد" 0 "$(docker inspect -f '{{.State.ExitCode}}' "$(compose ps -aq migrate)")"
expect "HTTP به HTTPS می‌رود" 308 "$(curl -s -o /dev/null -w '%{http_code}' http://localhost/)"
# standalone پوشه‌ی static را کپی نمی‌کند؛ اگر Dockerfile جا بیندازد صفحه بدون JS و CSS بالا می‌آید.
ASSET="$(http "$BASE/login" | grep -oE '/_next/static/[^"]+\.js' | sed -n 1p)"
[ -n "$ASSET" ] || fail "صفحه‌ی ورود فایل JS ندارد"
expect "فایل‌های static سرو می‌شوند" 200 "$(http -o /dev/null -w '%{http_code}' "$BASE$ASSET")"

step "۲. نقش‌ها"
expect "app_user نه superuser است نه BYPASSRLS" "f|f" "$(q "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='app_user'")"
expect "اپ با app_user وصل است" app_user "$(q "SELECT string_agg(DISTINCT usename, ',') FROM pg_stat_activity WHERE datname='tile_saas' AND pid <> pg_backend_pid()")"
# داخل فایل، نه با pipe: grep -q زود می‌بندد و pipefail آن را شکست حساب می‌کند.
compose logs web >"$WORK/web.log"
grep -q "DB role verification passed" "$WORK/web.log" || fail "چک نقش در startup اجرا نشد"
pass "چک نقش در startup اجرا شد"
SUPER_URL="postgresql://postgres:${PG_PW}@postgres:5432/tile_saas"
set +e
timeout 90 docker compose -f "$WORK/docker-compose.yml" run --rm --no-deps -T -e DATABASE_URL="$SUPER_URL" web >"$WORK/super.log" 2>&1
code=$?
set -e
expect "اپ با URL superuser بالا نمی‌آید" 1 "$code"
grep -q "SUPERUSER" "$WORK/super.log" || fail "پیام خطای superuser در لاگ نیست"

step "۳. ورود"
compose run --rm --no-deps -T -e ADMIN_PHONE="$ADMIN_PHONE" -e ADMIN_PASSWORD="$ADMIN_PASSWORD" migrate node dist-scripts/create-admin.js
expect "رمز اشتباه رد می‌شود" 401 "$(login "$WORK/bad.jar" "$ADMIN_PHONE" wrong-password)"
expect "مدیر پلتفرم وارد می‌شود" 200 "$(login "$WORK/platform.jar" "$ADMIN_PHONE" "$ADMIN_PASSWORD")"
grep -i '^set-cookie: *session=' "$WORK/platform.jar.headers" | grep -qi '; *secure' || fail "کوکی نشست Secure نیست"
pass "کوکی نشست Secure است"
expect "نشست معتبر است" 200 "$(http -o /dev/null -w '%{http_code}' -b "$WORK/platform.jar" "$BASE/api/me")"
expect "بدون نشست رد می‌شود" 401 "$(http -o /dev/null -w '%{http_code}' "$BASE/api/me")"
expect "Origin دیگر رد می‌شود" 403 "$(http -o /dev/null -w '%{http_code}' -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -X POST "$BASE/api/auth/login" -d '{}')"

TENANT_JSON="$(http -b "$WORK/platform.jar" "${ORIGIN[@]}" -X POST "$BASE/api/platform/tenants" \
  -d '{"name":"کارخانه تست","slug":"smoke","adminPhone":"09120000098","adminFullName":"مدیر تست"}')"
TENANT_ID="$(sed -E 's/.*"tenantId":"([^"]+)".*/\1/' <<<"$TENANT_JSON")"
TENANT_PW="$(sed -E 's/.*"tempPassword":"([^"]+)".*/\1/' <<<"$TENANT_JSON")"
expect "مدیر کارخانه با رمز موقت وارد می‌شود" 200 "$(login "$WORK/tenant.jar" 09120000098 "$TENANT_PW")"

step "۴. آپلود روی volume"
base64 -d >"$WORK/pixel.png" <<<'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
UPLOAD="$(http -b "$WORK/tenant.jar" -H "Origin: $BASE" -F "tenantId=$TENANT_ID" -F "file=@$WORK/pixel.png;type=image/png" "$BASE/api/upload")"
UPLOAD_NAME="$(sed -E 's#.*"/uploads/([^"]+)".*#\1#' <<<"$UPLOAD")"
[ -n "$UPLOAD_NAME" ] && [ "$UPLOAD_NAME" != "$UPLOAD" ] || fail "آپلود شکست خورد: $UPLOAD"
UPLOAD_SHA="$(sha256sum "$WORK/pixel.png" | cut -d' ' -f1)"
file_sha() { compose exec -T web sha256sum "/app/web/private/uploads/$UPLOAD_NAME" | cut -d' ' -f1; }
expect "فایل آپلودشده روی volume است" "$UPLOAD_SHA" "$(file_sha)"
# همان URLی که در DB ذخیره می‌شود، از Caddy و بدون نشست (کاتالوگِ اشتراکی ورود ندارد)
url_sha() { http "$BASE/uploads/$UPLOAD_NAME" | sha256sum | cut -d' ' -f1; }
expect "عکس با URLِ ذخیره‌شده و بدون ورود دیده می‌شود" "$UPLOAD_SHA" "$(url_sha)"

# پیامکِ دعوت: payload باید شیء باشد، نه رشته‌ی jsonb (متنِ پیامک در production لاگ نمی‌شود)
INVITE="$(http -b "$WORK/tenant.jar" "${ORIGIN[@]}" -X POST "$BASE/api/team"   -d "{\"tenantId\":\"$TENANT_ID\",\"phone\":\"09120000096\",\"role\":\"staff\"}")"
grep -q '"created":true' <<<"$INVITE" || fail "دعوت شکست خورد: $INVITE"
expect "payloadِ پیامکِ دعوت شیءِ JSON است و رمز دارد" "object t"   "$(q "SELECT jsonb_typeof(payload), payload ? 'tempPassword' FROM notification_outbox WHERE recipient='09120000096'" | tr '|' ' ')"

step "۵. workerها واقعاً کار می‌کنند"
q "
  INSERT INTO tenant (id, name, slug) VALUES ('$T', 'کارخانه RLS', 'smoke-rls');
  INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES ('$T', '$T', 'انبار', 'W1', 'main');
  INSERT INTO product (id, tenant_id, code, name) VALUES ('$T', '$T', 'P1', 'کاشی');
  INSERT INTO product_variant (id, tenant_id, product_id, sku, boxes_per_pallet) VALUES ('$T', '$T', '$T', 'SKU1', 96);
  INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id) VALUES ('$T', '$T', '$T', '$T');
  INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES ('$T', '$T', 100);
  INSERT INTO agent_account (id, tenant_id, legal_name, code) VALUES ('$T', '$T', 'نماینده', 'A1');
  INSERT INTO reservation (id, tenant_id, agent_account_id, status, created_at, expires_at) VALUES ('$T', '$T', '$T', 'active', now() - interval '2 hours', now() - interval '1 hour');
  INSERT INTO reservation_item (tenant_id, reservation_id, lot_id, quantity_boxes) VALUES ('$T', '$T', '$T', 5);
  INSERT INTO notification_outbox (id, tenant_id, recipient, payload) VALUES ('$T', '$T', '09120000097', '{\"text\":\"smoke\"}');
  INSERT INTO _rate_limit_hits (key, hit_at) VALUES ('smoke-old', now() - interval '2 days'), ('smoke-new', now());
" >/dev/null
# هر worker اول کار یک‌بار اجرا می‌شود؛ restart یعنی همین حالا، نه ۱۰ دقیقه‌ی دیگر.
compose restart worker-expire worker-outbox worker-housekeeping
wait_for "worker-expire رزرو منقضی را آزاد کرد" 60 query_is "SELECT status FROM reservation WHERE id='$T'" expired
wait_for "worker-outbox پیام را فرستاد" 60 query_is "SELECT status FROM notification_outbox WHERE id='$T'" sent
wait_for "worker-housekeeping ردیف قدیمی را پاک کرد" 60 query_is "SELECT string_agg(key, ',') FROM _rate_limit_hits WHERE key LIKE 'smoke-%'" smoke-new
for w in worker-expire worker-outbox worker-housekeeping; do
  expect "$w در حال اجراست و restart نشده" "running 0" "$(docker inspect -f '{{.State.Status}} {{.RestartCount}}' "$(compose ps -q "$w")")"
done
set +e
timeout 60 docker compose -f "$WORK/docker-compose.yml" run --rm --no-deps -T \
  -e DATABASE_URL="postgresql://app_user:wrong@postgres:5432/tile_saas" worker-expire >/dev/null 2>&1
code=$?
set -e
expect "خطای worker پنهان نمی‌ماند" 1 "$code"

step "۶. RLS روی view برای app_user"
app_q() { compose exec -T -e PGPASSWORD="$APP_PW" postgres psql -h 127.0.0.1 -U app_user -d tile_saas -v ON_ERROR_STOP=1 -Atc "$1"; }
expect "admin موجودی را می‌بیند" 1 "$(q 'SELECT count(*) FROM v_lot_availability')"
expect "app_user بدون tenant چیزی نمی‌بیند" 0 "$(app_q 'SELECT count(*) FROM v_lot_availability')"
expect "رمز app_user از .env ست شده" app_user "$(app_q 'SELECT current_user')"

step "۷. بکاپ"
bash "$WORK/scripts/backup-db.sh"
bash "$WORK/scripts/verify-backup.sh"
bash "$WORK/scripts/backup-uploads.sh"
# قبل از تست بازیابی، چون آن‌ها فایل status را بازنویسی می‌کنند و خرابی آن را می‌پوشانند.
http -b "$WORK/platform.jar" "$BASE/api/metrics" >"$WORK/metrics.json"
python3 - "$WORK/metrics.json" <<'PY' || fail "وضعیت بکاپ بعد از بکاپ موفق در /api/metrics نیست"
import json, sys
m = json.load(open(sys.argv[1]))
assert m["backup"]["last_success_at"] and m["backup"]["last_success_sha256"], m["backup"]
assert m["uploads_backup"]["last_success_at"], m["uploads_backup"]
PY
pass "وضعیت هر دو بکاپ بلافاصله در /api/metrics دیده می‌شود"
bash "$WORK/scripts/restore-db.sh" --test-only
bash "$WORK/scripts/restore-uploads.sh" --test-only | tee "$WORK/restore-uploads.log"
grep -q "Verifying against manifest" "$WORK/restore-uploads.log" || fail "بررسی manifest آپلودها اجرا نشد"
DB_BACKUP="$(ls -t "$WORK"/backups/daily/*.gpg | head -1)"
UPLOADS_BACKUP="$(ls -t "$WORK"/backups/uploads/*.gpg | head -1)"
expect "فایل بکاپ فقط برای مالک" 600 "$(stat -c%a "$DB_BACKUP")"
if zstd -tq "$DB_BACKUP" 2>/dev/null || zstd -tq "$UPLOADS_BACKUP" 2>/dev/null; then fail "بکاپ رمزنگاری نشده"; fi
pass "بکاپ بدون رمز باز نمی‌شود"
find "$WORK/offsite" -name "$(basename "$DB_BACKUP")" | grep -q . || fail "بکاپ دیتابیس به مقصد بیرونی نرسید"
find "$WORK/offsite" -name "$(basename "$UPLOADS_BACKUP")" | grep -q . || fail "بکاپ آپلودها به مقصد بیرونی نرسید"
pass "هر دو بکاپ با rsync به مقصد بیرونی رسیدند"

old_db="$WORK/backups/daily/tile_saas_2020-01-01_0000.sql.zstd.gpg"
old_up="$WORK/backups/uploads/uploads_2020-01-01_0000.tar.zst.gpg"
touch -d '100 days ago' "$old_db" "$old_up"
bash "$WORK/scripts/cleanup-old-backups.sh"
bash "$WORK/scripts/cleanup-old-uploads-backups.sh"
[ ! -e "$old_db" ] && [ ! -e "$old_up" ] || fail "بکاپ قدیمی پاک نشد"
[ -e "$DB_BACKUP" ] && [ -e "$UPLOADS_BACKUP" ] || fail "cleanup بکاپ تازه را پاک کرد"
pass "cleanup فقط بکاپ قدیمی را پاک کرد"

step "۸. فاجعه: همه‌چیز پاک، بازیابی از بکاپ روی نصب خالی"
cp "$DB_BACKUP" "$WORK/corrupt.gpg"
cp "$DB_BACKUP.sha256" "$WORK/corrupt.gpg.sha256"
printf 'x' >>"$WORK/corrupt.gpg"
if bash "$WORK/scripts/restore-prod.sh" --overwrite-production "$WORK/corrupt.gpg" 2>/dev/null; then fail "بکاپ خراب پذیرفته شد"; fi
ready || fail "بکاپ خراب سایت را از کار انداخت"
pass "بکاپ با checksum غلط رد شد و سایت بالا ماند"
head -c 2000 "$DB_BACKUP" >"$WORK/short.gpg"
sha256sum "$WORK/short.gpg" >"$WORK/short.gpg.sha256"
if bash "$WORK/scripts/restore-prod.sh" --overwrite-production "$WORK/short.gpg" 2>/dev/null; then fail "بکاپ ناقص پذیرفته شد"; fi
ready || fail "بکاپ ناقص سایت را از کار انداخت"
pass "بکاپ ناقص با checksum درست رد شد و سایت بالا ماند"
good_pass="$(grep '^BACKUP_GPG_PASSPHRASE=' "$WORK/.env" | cut -d= -f2)"
sed -i "s/^BACKUP_GPG_PASSPHRASE=.*/BACKUP_GPG_PASSPHRASE=wrong-passphrase/" "$WORK/.env"
if bash "$WORK/scripts/restore-prod.sh" --overwrite-production "$DB_BACKUP" 2>/dev/null; then fail "رمز اشتباه پذیرفته شد"; fi
sed -i "s/^BACKUP_GPG_PASSPHRASE=.*/BACKUP_GPG_PASSPHRASE=${good_pass}/" "$WORK/.env"
ready || fail "رمز اشتباه سایت را از کار انداخت"
pass "رمز اشتباه رد شد و سایت بالا ماند"
if bash "$WORK/scripts/restore-prod.sh" "$DB_BACKUP" 2>/dev/null; then fail "بدون --overwrite-production اجرا شد"; fi
pass "بدون --overwrite-production اجرا نمی‌شود"

BEFORE="$(q "SELECT (SELECT count(*) FROM tenant), (SELECT count(*) FROM app_user), (SELECT sum(on_hand_qty_boxes) FROM inventory_balance), (SELECT status FROM reservation WHERE id='$T')")"
compose down -v
expect "volumeها واقعاً پاک شدند" 0 "$(docker volume ls -q --filter "name=${COMPOSE_PROJECT_NAME}_" | wc -l)"
# سرور تازه طبق GO_LIVE: نصب با رمزهای تازه، بعد برگرداندن .env قبلی و بازیابی.
cp "$WORK/.env" "$WORK/env.old"
rm "$WORK/.env"
bash "$WORK/scripts/init-env.sh" localhost
compose up -d
wait_for "نصب تازه بالا آمد" 180 ready
cp "$WORK/env.old" "$WORK/.env"
bash "$WORK/scripts/restore-prod.sh" --overwrite-production "$DB_BACKUP" "$UPLOADS_BACKUP"
wait_for "سایت بعد از بازیابی بالا آمد" 180 ready
expect "داده همان است" "$BEFORE" "$(q "SELECT (SELECT count(*) FROM tenant), (SELECT count(*) FROM app_user), (SELECT sum(on_hand_qty_boxes) FROM inventory_balance), (SELECT status FROM reservation WHERE id='$T')")"
expect "فایل آپلود همان است" "$UPLOAD_SHA" "$(file_sha)"
expect "عکس بعد از بازیابی با همان URL دیده می‌شود" "$UPLOAD_SHA" "$(url_sha)"
expect "مدیر پلتفرم با همان رمز وارد می‌شود" 200 "$(login "$WORK/after.jar" "$ADMIN_PHONE" "$ADMIN_PASSWORD")"
expect "مدیر کارخانه با همان رمز وارد می‌شود" 200 "$(login "$WORK/after2.jar" 09120000098 "$TENANT_PW")"
expect "نشست بعد از بازیابی معتبر است" 200 "$(http -o /dev/null -w '%{http_code}' -b "$WORK/after.jar" "$BASE/api/me")"
expect "اپ بعد از بازیابی با app_user وصل است" app_user "$(q "SELECT string_agg(DISTINCT usename, ',') FROM pg_stat_activity WHERE datname='tile_saas' AND pid <> pg_backend_pid()")"
expect "RLS روی view بعد از بازیابی" 0 "$(app_q 'SELECT count(*) FROM v_lot_availability')"
expect "توابع SECURITY DEFINER برای PUBLIC بسته‌اند" 0 "$(q "SELECT count(*) FROM pg_proc p WHERE p.prosecdef AND p.pronamespace='public'::regnamespace AND (p.proacl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0))")"
q "INSERT INTO notification_outbox (tenant_id, recipient, payload) VALUES ('$T', '09120000096', '{\"text\":\"after-restore\"}')" >/dev/null
compose restart worker-outbox
wait_for "worker بعد از بازیابی کار می‌کند" 60 query_is "SELECT status FROM notification_outbox WHERE recipient='09120000096'" sent

step "۹. ارتقای دوباره و ریبوت"
compose run --rm --no-deps -T migrate >"$WORK/migrate2.log"
grep -q "0 migration تازه" "$WORK/migrate2.log" || fail "migrate دوم چیزی اجرا کرد"
pass "migrate دوباره چیزی را عوض نمی‌کند"
# ریبوت سرور: Docker ترتیب depends_on را رعایت نمی‌کند و اپ ممکن است قبل از Postgres بالا بیاید.
compose stop web postgres
docker start "$(compose ps -aq web)" >/dev/null
web_restarted() { [ "$(docker inspect -f '{{.RestartCount}}' "$(compose ps -aq web)")" -ge 1 ]; }
wait_for "اپ بدون Postgres خارج می‌شود و Docker دوباره می‌سازدش" 120 web_restarted
docker start "$(compose ps -aq postgres)" >/dev/null
wait_for "با برگشتن Postgres سایت خودش درست شد" 120 ready

step "۱۰. نصب با IP به‌جای دامنه"
sed -i "s/^DOMAIN=.*/DOMAIN=127.0.0.1/" "$WORK/.env"
compose up -d caddy
ip_ready() { [ "$(http -o /dev/null -w '%{http_code}' https://127.0.0.1/api/ready)" = 200 ]; }
wait_for "سایت با IP روی HTTPS جواب می‌دهد" 60 ip_ready

step "نتیجه"
echo "✓ همه‌ی مراحل نصب تمیز سبز شد."
