# RESTORE_RUNBOOK — دستورالعملِ بازیابیِ دیتابیس

> **این سند برایِ اپراتورهای on-call است.** در زمانِ فاجعه، این فایل را باز کنید
> و قدم به قدم پیش بروید. اگر سوالی دارید که این سند پاسخ نمی‌دهد، در
> `docs/DISASTER_RECOVERY.md` (سناریوهای کامل) یا `docs/BACKUP_POLICY.md`
> (سیاست) نگاه کنید.

---

## ۱. چه زمانی از این سند استفاده کنیم؟

| موقعیت | از این سند استفاده کنید |
|---|---|
| داده‌های production از بین رفته/خراب شده | ✅ |
| نیاز به restore به یک نقطه‌ی زمانیِ مشخص | ✅ |
| تستِ هفتگیِ restore | ✅ (با `--test-only`) |
| مهاجم به دیتابیس دسترسی پیدا کرده | ✅ + `DISASTER_RECOVERY.md` |
| VPS از دست رفته | ⚠️ `DISASTER_RECOVERY.md` کامل |
| فقط یک جدول خراب شده | ⚠️ بخشِ ۵ را ببینید (selective restore) |

---

## ۲. پیش‌نیازها

### ۲.۱ دسترسی

- SSH به VPS production (یا VPS بازیابی)
- `BACKUP_GPG_PASSPHRASE` (در password manager یا vault)
- نقشِ superuser در PostgreSQL (`POSTGRES_USER` و `POSTGRES_PASSWORD`)

### ۲.۲ ابزارها

```bash
# نصبِ ابزارها اگر موجود نیستند
sudo apt-get install -y zstd gpg postgresql-client
# یا در Alpine:
apk add zstd gnupg postgresql-client
```

### ۲.۳ فایل‌های بکاپ

```bash
# فهرستِ بکاپ‌های موجود
ls -lh backups/daily/

# مثال:
# -rw------- 1 user user 1.2M Aug 24 03:00 tile_saas_2026-08-24_0300.sql.zstd.gpg
# -rw------- 1 user user 1.1M Aug 23 03:00 tile_saas_2026-08-23_0300.sql.zstd.gpg
# ...
```

اگر بکاپ روی storage خارج از VPS است، ابتدا آن را دانلود کنید:

```bash
# rsync از backup host
rsync -avz user@backup.example.com:/backups/tile-saas/tile_saas_2026-08-24_0300.sql.zstd.gpg \
  backups/daily/
```

---

## ۳. Restore کامل (Production)

> ⚠️ **هشدار:** این روش دیتابیسِ production را overwrite می‌کند. فقط در صورتِ
> قطعیِ کاملِ داده و با تأییدِ on-call engineer اجرا کنید.

### ۳.۱ توقفِ application

```bash
# ترافیک را در Caddy/Nginx قطع کنید تا کاربران خطای 503 ببینند (بهتر از خطای 500)
docker compose stop web worker-expire worker-outbox worker-housekeeping
# postgres را نگه دارید — برای restore لازم است
```

### ۳.۲ انتخابِ بکاپ

```bash
# بکاپِ آخرین موفق را پیدا کن
LATEST=$(ls -t backups/daily/*.gpg | head -1)
echo "Will restore: ${LATEST}"

# یا بکاپِ یک تاریخِ مشخص
BACKUP="backups/daily/tile_saas_2026-08-24_0300.sql.zstd.gpg"
```

### ۳.۳ Verify قبل از restore

```bash
# Verify (decrypt + check format) — نباید شکست بخورد
bash scripts/verify-backup.sh "${BACKUP}"
```

اگر verify شکست خورد، **همان لحظه بایستید** و بکاپِ قدیمی‌تر را امتحان کنید.

### ۳.۴ Backup از دیتابیسِ فعلی (defense-in-depth)

حتی اگر فکر می‌کنید دیتابیس خراب است، یک dump بگیرید — ممکن است بعد لازم شود:

```bash
# Snapshot از دیتابیسِ فعلی (با timestamp متفاوت)
docker compose exec -T postgres \
  pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --format=custom \
  > "backups/daily/pre_restore_$(date -u +%Y-%m-%d_%H%M).dump"
```

### ۳.۵ Drop و recreate دیتابیسِ production

```bash
# ⚠️ این داده‌ی فعلیِ production را پاک می‌کند
# مطمئن شوید snapshot بالا گرفته شده

# قطعِ همه‌ی sessionها
docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  psql -U "${POSTGRES_USER}" -d postgres -c "
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '${POSTGRES_DB}' AND pid <> pg_backend_pid();
  "

# Drop و recreate
docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  psql -U "${POSTGRES_USER}" -d postgres -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};"

docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  psql -U "${POSTGRES_USER}" -d postgres -c "CREATE DATABASE ${POSTGRES_DB};"
```

### ۳.۶ Restore از فایلِ بکاپ

```bash
# Decrypt + decompress + restore
TMP_RESTORE=$(mktemp -d)
trap "rm -rf ${TMP_RESTORE}" EXIT

# Decrypt و decompress
echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt "${BACKUP}" 2>/dev/null \
  | zstd -d > "${TMP_RESTORE}/dump.sql"

# Verify format
head -c 5 "${TMP_RESTORE}/dump.sql" | grep -q "^PGDMP" || {
  echo "ERROR: Invalid dump format"
  exit 1
}

# Restore
docker cp "${TMP_RESTORE}/dump.sql" \
  "$(docker compose ps -q postgres):/tmp/restore.dump"

docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  pg_restore -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
    --no-owner --no-privileges --exit-on-error \
    /tmp/restore.dump

# Cleanup
docker compose exec -T postgres rm -f /tmp/restore.dump
```

### ۳.۷ اعمالِ مجددِ دسترسی‌ها

بکاپ با `--no-owner --no-privileges` گرفته شده، پس دسترسی‌ها باید دوباره
اعمال شوند:

```bash
# اجرای create-app-user.sql برایِ بازنشانیِ GRANTها
docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  -f /docker-entrypoint-initdb.d/02-create-app-user.sql

# (اگر create-app-user.sql در container mount نشده، آن را docker cp کنید)
```

### ۳.۸ Migrationها را اجرا کنید (اگر بکاپ قدیمی است)

اگر بکاپ از قبل از یک migration گرفته شده، آن را apply کنید:

```bash
cd web
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}" \
  AUTH_SECRET="${AUTH_SECRET}" \
  node --import tsx ../db/migrations/apply.ts
```

### ۳.۹ Verification

```bash
# Integrity checks (از restore-db.sh استفاده کنید با target=production)
# ⚠️ مراقب باشید — restore-db.sh به طور پیش‌فرض روی tile_restore_test اجرا می‌شود
# برای verification production، دستی اجرا کنید:

docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -t -c "
    SELECT count(*) FROM information_schema.tables WHERE table_schema='public';
  "
# انتظار: ≥ 38

docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -t -c "SELECT count(*) FROM tenant;"
# انتظار: ≥ 1

docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -t -c "
    SELECT count(*) FROM app_user WHERE is_platform_admin;
  "
# انتظار: ≥ 1
```

### ۳.۱۰ Restart application

```bash
docker compose start web worker-expire worker-outbox worker-housekeeping

# Wait 10 seconds then verify
sleep 10
curl -fsS http://localhost:3000/api/health || echo "❌ Health check failed"
curl -fsS http://localhost:3000/api/ready || echo "❌ Ready check failed"
```

### ۳.۱۱ ترافیک را برگردانید

```bash
# اگر Caddy/Nginx را stop کرده‌اید
sudo systemctl restart caddy
# یا
docker compose start caddy
```

---

## ۴. Restore Test (بدونِ دست زدن به Production)

این همان است که اسکریپتِ `restore-db.sh` به‌صورتِ خودکار اجرا می‌کند. برایِ
تستِ دستی یا debugging:

```bash
# روی دیتابیسِ موقتِ tile_restore_test اجرا می‌شود (نه production)
bash scripts/restore-db.sh --test-only

# یا با فایلِ مشخص
bash scripts/restore-db.sh backups/daily/tile_saas_2026-08-24_0300.sql.zstd.gpg

# اگر می‌خواهید دیتابیسِ موقت را پاک نکنید (برایِ debugging)
bash scripts/restore-db.sh --test-only --no-cleanup
```

این روش **کاملاً امن** است — هیچ‌وقت به production دست نمی‌زند.

---

## ۵. Selective Restore (یک جدول)

گاهی فقط یک جدول خراب شده و نمی‌خواهید کلِ دیتابیس را restore کنید.

```bash
# ۱. Backup فعلیِ production را بگیرید (snapshot)
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
  --table=product --format=custom > /tmp/product_current.dump

# ۲. Restore بکاپ قدیمی به دیتابیسِ موقت
bash scripts/restore-db.sh backups/daily/tile_saas_2026-08-20_0300.sql.zstd.gpg --no-cleanup

# ۳. جدولِ مشخص را از دیتابیسِ موقت export کنید
docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  pg_dump -U "${POSTGRES_USER}" -d tile_restore_test --table=product --data-only \
  > /tmp/product_data.sql

# ۴. داده‌ی فعلی را پاک کنید و از export جایگزین کنید
docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -c "TRUNCATE product CASCADE;"

docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" < /tmp/product_data.sql

# ۵. Cleanup
docker compose exec -T -e PGPASSWORD="${POSTGRES_PASSWORD}" postgres \
  psql -U "${POSTGRES_USER}" -d postgres -c "DROP DATABASE tile_restore_test;"

rm /tmp/product_current.dump /tmp/product_data.sql
```

> **هشدار:** selective restore می‌تواند foreign key inconsistencies ایجاد کند.
> حتماً بعد از آن `SELECT * FROM ... WHERE id NOT IN (...)` بررسی کنید.

---

## ۶. عیب‌یابی (Troubleshooting)

### ۶.۱ `gpg: decryption failed: Bad session key`

- Passphrase اشتباه است. در password manager دوباره چک کنید.
- اگر passphrase گم شده، **بکاپ قابلِ بازیابی نیست** — این یک ریسک است که در
  `BACKUP_POLICY.md` توضیح داده شده.

### ۶.۲ `zstd: unknown frame format`

- فایلِ GPG خراب است (احتمالاً upload ناقص بوده).
- فایلِ `.sha256` را با `sha256sum -c` چک کنید.
- اگر checksum مطابقت نداشت، فایل از storage off-site دوباره دانلود کنید.

### ۶.۳ `pg_restore: could not execute query: ERROR: relation "..." does not exist`

- بکاپ قدیمی است و schema تغییر کرده. باید migrationها را اجرا کنید
  (بخشِ ۳.۸).
- یا اینکه restore با خطا مواجه شده — `--exit-on-error` را موقتاً بردارید
  تا `pg_restore` ادامه بدهد و ببینید چه جدولی مشکل دارد.

### ۶.۴ `pg_restore: [archiver] unsupported version (...) in file`

- بکاپ با نسخه‌ی قدیمی‌ترِ pg_dump گرفته شده و pg_restore فعلی از آن پشتیبانی
  نمی‌کند (یا برعکس).
- راه‌حل: همان نسخه‌ی pg_restore که بکاپ با آن گرفته شده را استفاده کنید.

### ۶.۵ `FATAL: role "app_user" cannot connect`

- GRANTها بعد از restore اعمال نشده‌اند.
- بخشِ ۳.۷ را اجرا کنید.

### ۶.۶ Container در حالِ restart loop است بعد از restore

- بررسی کنید `app_user` وجود دارد و GRANTهای درست دارد.
- بررسی کنید schema migration درست apply شده: `SELECT * FROM _migrations ORDER BY id;`
- لاگ container را چک کنید: `docker compose logs web --tail 50`

---

## ۷. Post-Restore Checklist

```text
[ ] Snapshot از دیتابیسِ فعلیِ production گرفته شد (قبل از restore)
[ ] Verify بکاپ موفق بود
[ ] Restore موفق بود (exit code 0)
[ ] Integrity checks پاس شدند (table count, FK validity, tenant presence)
[ ] Migrationهای معتبر applied شدند
[ ] GRANTها اعمال شدند
[ ] Application restart شد
[ ] /api/health → 200
[ ] /api/ready → 200 (DB در دسترس)
[ ] یک کاربر می‌تواند login کند (تست دستی)
[ ] یک query واقعی کار می‌کند (مثلاً صفحه‌ی /staff/catalog)
[ ] ترافیک در reverse proxy برگردانده شد
[ ] کاربران عادی نمی‌توانند به اطلاعات حساس دسترسی پیدا کنند
[ ] لاگ application خطای جدید ندارد (Sentry dashboard)
[ ] Postmortem در ۴۸ ساعتِ آینده نوشته می‌شود
```

---

## ۸. RPO و RTO بعد از Restore

پس از restore موفق:

- **RPO واقعی:** فاصله‌ی زمانی بینِ آخرین بکاپِ موفق و لحظه‌ی فاجعه.
  - مثال: آخرین بکاپ ۲ ساعت پیش بود. RPO = ۲ ساعت.
- **RTO واقعی:** فاصله‌ی زمانی بینِ شروعِ فاجعه و restart موفقِ سرویس.
  - مثال: فاجعه ساعت ۱۰:۰۰ رخ داد، سرویس ساعت ۱۱:۳۰ بالا آمد. RTO = ۱.۵ ساعت.

این مقادیر را در incident report ثبت کنید (بخشِ ۱۰ در `DISASTER_RECOVERY.md`).

---

## ۹. دستورهای سریع (Cheat Sheet)

```bash
# Find latest backup
ls -t backups/daily/*.gpg | head -1

# Quick verify
bash scripts/verify-backup.sh

# Restore test (safe — uses tile_restore_test)
bash scripts/restore-db.sh --test-only

# Restore to production (DESTRUCTIVE — read this whole doc first)
# See section 3.

# List all backups with size and date
ls -lh backups/daily/

# Check backup status file
cat backups/status/backup-status.json

# View backup metrics via API
curl -fsS http://localhost:3000/api/metrics | jq .backup
```
