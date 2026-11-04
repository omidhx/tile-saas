# DR — Database Outage Recovery

> **Severity:** SEV-1 (Critical)
> **RTO Target:** ۲ ساعت
> **RPO Target:** ۲۴ ساعت
>
> **Runbook:** بازیابی دیتابیس از آخرین بک‌آپ رمزنگاری‌شده در صورت خرابی
> کامل یا از دست رفتن Volume.

---

## ۱. Trigger Conditions

- PostgreSQL container در حال restart loop است.
- `/api/ready` 503 برمی‌گرداند (DB not ready).
- `pg_isready` fail می‌کند.
- Volume `pgdata` خراب شده یا حذف شده.
- Data corruption (query‌ها خطای غیرمنتظره می‌دهند).
- Ransomware یا رخنه امنیتی.

---

## ۲. Immediate Actions (دقیقه ۰–۱۵)

### ۲.۱. اعلام incident

```bash
# در Telegram group: #tile-saas-incidents
[INCIDENT-YYYYMMDD-01] SEV-1
Status: Investigating
Summary: PostgreSQL unavailable — /api/ready returning 503
Impact: All users unable to access the service
Action: Checking container status + backup availability
Next update: 15 min
```

### ۲.۲. بررسی وضعیت

```bash
ssh root@vps
cd /opt/tile-saas

# بررسی container
docker compose ps postgres

# بررسی logs
docker compose logs --tail 50 postgres

# بررسی health
docker compose exec -T postgres pg_isready -U postgres 2>&1 || echo "PG NOT READY"

# بررسی disk space
df -h
```

### ۲.۳. تصمیم: restore یا fix؟

| وضعیت | اقدام |
|---|---|
| Container restart loop ولی volume سالم | `docker compose restart postgres` — شاید fix شود |
| Volume corrupt یا data inconsistency | **Restore از backup** (ادامه این runbook) |
| Disk full | `disk-pressure-and-cleanup.md` — ثم restore |
| Security breach | `secret-rotation.md` — rotate همه secrets، ثم restore |

---

## ۳. Backup Availability Check (دقیقه ۱۵–۳۰)

### ۳.۱. بررسی backup‌های محلی

```bash
ls -lh backups/daily/*.gpg
# انتظار: حداقل یک فایل .sql.zstd.gpg از ۲۴ ساعت گذشته
```

### ۳.۲. بررسی backup‌های off-site

```bash
# اگر BACKUP_OFFSITE_TARGET ست شده:
rsync --list-only "${BACKUP_OFFSITE_TARGET}/" | grep ".gpg"
```

### ۳.۳. بررسی status file

```bash
cat backups/status/backup-status.json | python3 -m json.tool
# انتظار: last_success_at اخیر، last_failure_at = null
```

### ۳.۴. Verify backup قبل از restore

```bash
# Verify بدون restore کامل
bash scripts/verify-backup.sh
# انتظار: exit 0، "Backup file is valid and ready for restore."
```

**اگر verify fail شد:** قدیمی‌ترین backup را امتحان کن. اگر هیچ backup معتبری نیست،
این **SEV-1 Catastrophic** است — داده از دست رفته. IC باید فوراً مطلع شود.

---

## ۴. Restore Procedure (دقیقه ۳۰–۹۰)

### ۴.۱. توقف application

```bash
docker compose stop web worker-expire worker-outbox worker-housekeeping
# postgres را نگه دار — برای restore لازم است
```

### ۴.۲. Snapshot از دیتابیس فعلی (defense-in-depth)

```bash
# حتی اگر خراب است، یک snapshot بگیر — ممکن است بعد لازم شود
docker compose exec -T postgres pg_dump -U postgres tile_saas --format=custom \
  > "backups/daily/pre_restore_$(date +%Y-%m-%d_%H%M).dump" 2>/dev/null || true
```

### ۴.۳. Drop و recreate دیتابیس

```bash
docker compose exec -T postgres psql -U postgres -d postgres -c "
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE datname = 'tile_saas' AND pid <> pg_backend_pid();
"
docker compose exec -T postgres psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS tile_saas;"
docker compose exec -T postgres psql -U postgres -d postgres -c "CREATE DATABASE tile_saas;"
```

### ۴.۴. Restore از encrypted backup

```bash
# آخرین backup موفق
LATEST=$(ls -t backups/daily/*.gpg | head -1)
echo "Restoring from: ${LATEST}"

# Decrypt + decompress + restore
TMP_RESTORE=$(mktemp -d)
echo "${BACKUP_GPG_PASSPHRASE}" | gpg \
  --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
  --decrypt "${LATEST}" 2>/dev/null \
  | zstd -d > "${TMP_RESTORE}/dump.sql"

# Verify PGDMP magic
MAGIC=$(head -c 5 "${TMP_RESTORE}/dump.sql")
if [ "${MAGIC}" != "PGDMP" ]; then
  echo "FATAL: Invalid backup format"
  exit 1
fi

# Copy to container and restore
CONTAINER_DUMP="/tmp/restore-$(date +%s).dump"
docker cp "${TMP_RESTORE}/dump.sql" "$(docker compose ps -q postgres):${CONTAINER_DUMP}"

docker compose exec -T postgres pg_restore \
  -U postgres -d tile_saas \
  --no-owner --no-privileges --exit-on-error \
  "${CONTAINER_DUMP}"

docker compose exec -T postgres rm -f "${CONTAINER_DUMP}"
rm -rf "${TMP_RESTORE}"
```

### ۴.۵. اعمال مجدد دسترسی‌ها

```bash
# Re-run create-app-user.sql برای GRANTها
docker compose exec -T postgres psql -U postgres -d tile_saas \
  -f /docker-entrypoint-initdb.d/02-create-app-user.sql
# یا اگر mount نشده:
docker compose exec -T postgres psql -U postgres -d tile_saas \
  -f db/create-app-user.sql
```

### ۴.۶. Migrationها (اگر backup قدیمی است)

```bash
cd web
DATABASE_URL="postgresql://postgres:stagingpw@localhost:5432/tile_saas" \
  AUTH_SECRET="${AUTH_SECRET}" \
  NODE_PATH="$(pwd)/node_modules" \
  node --import tsx ../db/migrations/apply.ts
cd ..
```

---

## ۵. Verification (دقیقه ۹۰–۱۲۰)

### ۵.۱. Integrity checks

```bash
# Table count (≥ ۳۸)
docker compose exec -T postgres psql -U postgres -d tile_saas -t -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"

# Migrations (≥ ۳)
docker compose exec -T postgres psql -U postgres -d tile_saas -t -c \
  "SELECT count(*) FROM _migrations;"

# Tenants (≥ ۱)
docker compose exec -T postgres psql -U postgres -d tile_saas -t -c \
  "SELECT count(*) FROM tenant;"

# Platform admin (≥ ۱)
docker compose exec -T postgres psql -U postgres -d tile_saas -t -c \
  "SELECT count(*) FROM app_user WHERE is_platform_admin;"

# RLS policies (≥ ۱)
docker compose exec -T postgres psql -U postgres -d tile_saas -t -c \
  "SELECT count(*) FROM pg_policy;"

# SECURITY DEFINER functions (≥ ۴)
docker compose exec -T postgres psql -U postgres -d tile_saas -t -c \
  "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.prosecdef=true;"
```

### ۵.۲. Application restart + smoke test

```bash
docker compose start web worker-expire worker-outbox worker-housekeeping

# Wait for readiness
for i in $(seq 1 30); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/ready 2>/dev/null)
  if [ "${STATUS}" = "200" ]; then
    echo "✅ App is ready (attempt $i)"
    break
  fi
  sleep 2
done

# Health check
curl -s http://localhost:3000/api/health | python3 -m json.tool
# انتظار: {"status":"ok"}
```

### ۵.۳. کاربردی smoke test

```bash
# Login با platform admin (دستی)
# Browse /staff/catalog — باید داده نشان دهد
# Browse /staff/ledger — باید ledger سالم باشد
# یک reservation ایجاد کن (اگر امکان‌پذیر)
```

### ۵.۴. ترافیک را برگردان

```bash
# Caddy را restart کن (اگر stop شده بود)
docker compose start caddy
# یا
sudo systemctl restart caddy
```

---

## ۶. Post-Restore Checklist

```text
[ ] Database responsive (SELECT 1)
[ ] Table count ≥ 38
[ ] Migrations ≥ 3
[ ] Tenants ≥ 1
[ ] Platform admin ≥ 1
[ ] RLS policies installed
[ ] SECURITY DEFINER functions present
[ ] /api/health → 200
[ ] /api/ready → 200
[ ] Login works (manual test)
[ ] /staff/catalog shows data
[ ] /staff/ledger is consistent
[ ] Sentry receiving events (if configured)
[ ] Workers running (docker compose ps)
[ ] Caddy routing traffic
[ ] Backup status file updated
[ ] Postmortem scheduled (if SEV-1)
```

---

## ۷. RPO و RTO واقعی

پس از restore موفق:

- **RPO واقعی:** فاصله‌ی زمانی بین آخرین backup موفق و لحظه خرابی.
  - مثال: آخرین backup ۶ ساعت پیش بود. RPO = ۶ ساعت.
- **RTO واقعی:** فاصله‌ی زمانی بین شروع خرابی و restart موفق سرویس.
  - مثال: خرابی ساعت ۱۰:۰۰، سرویس ساعت ۱۱:۳۰ بالا آمد. RTO = ۱.۵ ساعت.

این مقادیر در incident report ثبت شوند.

---

## ۸. ارتباط با سایر Runbookها

| Runbook | ارتباط |
|---|---|
| `secret-rotation.md` | اگر خرابی ناشی از رخنه امنیتی باشد |
| `disk-pressure-and-cleanup.md` | اگر خرابی ناشی از disk full باشد |
| `emergency-rollback.md` | اگر خرابی ناشی از deployment باشد |
| `dr-uploads-recovery.md` | اگر فایل‌های uploads هم تحت تأثیر باشند |
| `../RESTORE_RUNBOOK.md` | مرجع کامل restore procedure |
| `../DISASTER_RECOVERY.md` | DR runbook کلی |
