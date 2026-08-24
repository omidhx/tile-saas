# Staging Execution Runbook — اجرای Staging روی Docker Host مجاز

> **هدف:** این سند دستورالعملِ اجرای staging runtime روی یک host با Docker است،
> بدون تماس با production. این فایل پس از گزارش BLOCKED (Docker unavailable in
> sandbox) ساخته شده و آماده‌ی اجرا روی VPS یا local machine است.

---

## ۰. پیش‌نیازهای محیط

| پیش‌نیاز | چک |
|---|---|
| Docker Engine نصب و running | `docker version` |
| Docker Compose plugin موجود | `docker compose version` |
| فضای دیسک ≥ ۵GB | `df -h` |
| user فعلی permission اجرای Docker دارد | `id` + `docker ps` |
| host production نیست | بررسی hostname، env vars، volume names |
| repository روی commit `be245bf` است | `git rev-parse HEAD` |
| staging credentials جداگانه آماده است | `.env` با مقادیر staging-only |
| staging backup path جدا از production است | بررسی `BACKUP_OFFSITE_TARGET` |

---

## ۱. پیش‌بررسی host

```bash
# بررسی Docker daemon
docker version
docker compose version
docker info

# بررسی سیستم
uname -a
df -h
id

# بررسی repository
cd /path/to/tile-saas
git rev-parse HEAD
git status --short
```

**الزامات:**
- Docker daemon running باشد.
- Compose version ≥ v2 (برای `docker compose` plugin syntax).
- فضای دیسک برای image (~۱GB)، PostgreSQL data (~۱۰۰MB)، backup (~۵۰MB) و restore test (~۵۰MB) کافی باشد.
- user فعلی در گروه `docker` باشد یا دسترسی passwordless sudo داشته باشد.
- host production نباشد — اگر هست، staging را اجرا نکن مگر isolation کامل تأییدشده باشد.

---

## ۲. بررسی ایزولایشن staging

```bash
# audit config بدون افشای secret
docker compose -f docker-compose.staging.yml config
```

**مقادیر حساس را در report mask کن.** فقط وجود متغیرها و masked مقدار را گزارش ده.

**تأییدات لازم:**

| مورد | انتظار |
|---|---|
| DB name | `tile_staging` (≠ production `tile_saas`) |
| DB volume | `pgdata-staging` (≠ production `pgdata`) |
| Uploads volume | `uploads-staging` (≠ production `uploads`) |
| Backup directory | `./backups/` (محلی، جدا از production backup path) |
| DATABASE_URL | به `tile_staging` اشاره می‌کند |
| GPG passphrase | جداگانه‌ی staging (not production) |
| rsync destination | خالی یا mock/local (not production remote) |
| staging secret در repository commit نشده | `git log -p --all -S 'BACKUP_GPG_PASSPHRASE' -- .env` خالی باشد |

**اگر هر موردی ambiguous بود → اجرا را متوقف کن و BLOCKED گزارش بده.**

---

## ۳. static checks روی host

```bash
# Static syntax checks
git diff --check
bash -n scripts/backup-db.sh
bash -n scripts/verify-backup.sh
bash -n scripts/restore-db.sh
bash -n scripts/cleanup-old-backups.sh
bash -n scripts/staging-verify.sh

# Compose config validation
docker compose -f docker-compose.staging.yml config --quiet
```

**نکته:** اینها static checks هستند. runtime verification در مراحل بعدی انجام می‌شود.

---

## ۴. build و startup

```bash
# Build images (no cache برای اطمینان از clean state)
docker compose -f docker-compose.staging.yml build --no-cache

# Start services
docker compose -f docker-compose.staging.yml up -d

# بررسی وضعیت
docker compose -f docker-compose.staging.yml ps --all
```

**منتظر healthcheck واقعی PostgreSQL بمان (نه sleep ثابت):**

```bash
# بررسی health-based readiness
docker compose -f docker-compose.staging.yml exec -T postgres \
  pg_isready -U postgres -d tile_staging

# بررسی logs (بدون چاپ secret)
docker compose -f docker-compose.staging.yml logs --no-color postgres
docker compose -f docker-compose.staging.yml logs --no-color web
```

**الزام:** PostgreSQL باید `ready to accept connections` گزارش دهد.

---

## ۵. migration و schema runtime

روی staging database بررسی کن:

```bash
# بررسی migrationها
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -t -c "SELECT count(*) FROM _migrations;"

# بررسی table count
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -t -c "
    SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"

# بررسی RLS policies
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -t -c "SELECT count(*) FROM pg_policy;"

# بررسی SECURITY DEFINER functions
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -t -c "
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef=true;"

# بررسی extensions
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -t -c "SELECT extname, extversion FROM pg_extension;"
```

**انتظار:**
- migration count: ≥ ۳ (0002، 0003، 0004)
- table count: ≥ ۳۸
- RLS policies: ≥ ۱
- SECURITY DEFINER functions: ≥ ۴
- extensions: `pgcrypto` (برای `gen_random_uuid()`)

---

## ۶. اجرای چرخه‌ی واقعی

### ۶.۱. تنظیم environment

```bash
# تنظیم staging credentials در .env (با مقادیر staging-only)
cat > .env << 'ENV'
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<staging-password-here>
POSTGRES_DB=tile_staging
BACKUP_GPG_PASSPHRASE=<staging-passphrase-here-min-32-chars>
BACKUP_RETENTION_DAYS=30
BACKUP_OFFSITE_TARGET=
COMPOSE_FILE=docker-compose.staging.yml
ENV
```

### ۶.۲. اجرای backup

```bash
bash scripts/backup-db.sh
```

**ثبت evidence:**
- exit code
- backup file path (بدون secret)
- size progression: raw → zstd → gpg
- SHA-256 checksum
- verification result (PGDMP magic)
- status file content

### ۶.۳. اجرای verify

```bash
bash scripts/verify-backup.sh
```

### ۶.۴. اجرای restore test

```bash
bash scripts/restore-db.sh --test-only
```

**ثبت evidence:**
- restore database name: `tile_restore_test`
- pg_restore exit code
- integrity checks (table count، migrations، RLS، SECURITY DEFINER)
- smoke queries (user_contexts، expire_due_reservations، etc.)
- transaction test (BEGIN/INSERT/ROLLBACK)
- cleanup result (DROP DATABASE WITH FORCE)

---

## ۷. بررسی permission و فایل‌های موقت

```bash
# بررسی permission فایل‌های backup
find backups -type f -printf '%M %u:%g %p\n'

# انتظار:
# -rw------- 0600  .gpg files
# -rw------- 0600  .sha256 files
# -rw-r--r-- 0644  backup-status.json

# بررسی عدم وجود فایل plaintext
find backups -name "*.sql" -o -name "*.zst" | grep -v ".gpg" | head
# انتظار: خالی (هیچ plaintext dump باقی نمانده)

# بررسی lock file آزاد شده
ls -la /var/lock/tile-saas-backup-db.lock 2>/dev/null || echo "lock file cleaned up"
# یا
ls -la /tmp/tile-saas-backup-db.lock 2>/dev/null || echo "lock file cleaned up"

# بررسی restore database حذف شده
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d postgres -t -c "SELECT datname FROM pg_database WHERE datname='tile_restore_test';"
# انتظار: خالی
```

---

## ۸. بررسی failure path

فقط روی staging و با resourceهای isolate‌شده:

```bash
# ۸.۱. wrong passphrase
BACKUP_GPG_PASSPHRASE="wrong-passphrase" bash scripts/verify-backup.sh
# انتظار: exit non-zero، "GPG decrypt failed"

# ۸.۲. invalid RESTORE_DB_NAME
RESTORE_DB_NAME="tile_staging" bash scripts/restore-db.sh --test-only
# انتظار: exit non-zero، "RESTORE_DB_NAME must not equal POSTGRES_DB"

# ۸.۳. invalid BACKUP_TEST_HOLD_SECONDS
BACKUP_TEST_MODE=1 BACKUP_TEST_HOLD_SECONDS="abc" bash scripts/backup-db.sh
# انتظار: exit non-zero، "must be a non-negative number"

# ۸.۴. concurrent flock
BACKUP_TEST_MODE=1 BACKUP_TEST_HOLD_SECONDS=5 BACKUP_LOCK_FILE=/tmp/test.lock \
  bash scripts/backup-db.sh &
sleep 1
bash scripts/backup-db.sh
# انتظار: "already running"
rm -f /tmp/test.lock

# ۸.۵. SIGTERM cleanup
bash scripts/restore-db.sh --test-only &
PID=$!
sleep 2
kill -TERM $PID
wait $PID
echo "Exit code: $? (expected: 143 = 128+15)"
# انتظار: cleanup اجرا شد، tile_restore_test drop شد
```

---

## ۹. private/uploads (AUD-009)

```bash
# بررسی آیا private/uploads جداگانه backup می‌شود یا خیر
ls -la private/uploads/ 2>/dev/null || echo "private/uploads not present in this environment"
grep -r "private/uploads" scripts/ | head
```

**نتیجه مورد انتظار:** `private/uploads/` توسط Phase 8 backup system پشتیبانی **نمی‌شود**.

**وضعیت:**
- AUD-009: **Open**
- Database backup ≠ file/upload backup
- Disaster recovery incomplete until upload backup and restore are separately verified (Phase 9)

---

## ۱۰. cleanup

```bash
# بررسی نهایی وضعیت
docker compose -f docker-compose.staging.yml ps --all

# پاک‌سازی (فقط resourceهای staging)
docker compose -f docker-compose.staging.yml down

# اگر volumeها test-only و کاملاً متعلق به staging باشند:
# docker compose -f docker-compose.staging.yml down -v
# ⚠️ فقط پس از تأیید ownership — هیچ volume production را حذف نکن.
```

---

## ۱۱. معیار نهایی پذیرش Staging

Staging فقط در صورت اجرای واقعی همه‌ی موارد زیر Verified می‌شود:

```text
[ ] Docker Compose startup موفق
[ ] PostgreSQL healthcheck موفق
[ ] migrations applied (≥ ۳)
[ ] backup واقعی تولید شد
[ ] compression موفق
[ ] encryption موفق
[ ] checksum موفق
[ ] verification (PGDMP magic) موفق
[ ] restore به isolated test database موفق
[ ] integrity checks موفق (table count، RLS، SECURITY DEFINER)
[ ] transaction test (BEGIN/INSERT/ROLLBACK) موفق
[ ] cleanup موفق (restore DB dropped، temp files removed)
[ ] secret audit: no leak در logs
[ ] failure-path checks: wrong passphrase، invalid input، concurrent flock، SIGTERM
[ ] permission audit: 0600 for .gpg/.sha256، 0644 for status file
[ ] AUD-009 transparently reported
```

---

## ۱۲. متن مجاز پس از موفقیت

اگر همه‌ی موارد بالا PASS شد:

> **Phase 8 CI and Docker Compose staging backup/verify/restore cycles are runtime-verified.
> Production VPS execution, real production backup, and real production restore remain pending.**

اگر شکست خورد:

> **Phase 8 CI runtime is verified, but Docker Compose staging runtime remains unverified
> due to the findings listed in this report. Production verification remains pending.**

---

## ۱۳. ممنوعیت‌ها

- ❌ به production database متصل نشو.
- ❌ از production DATABASE_URL استفاده نکن.
- ❌ از production backup path استفاده نکن.
- ❌ از production GPG passphrase استفاده نکن.
- ❌ staging موفق را به‌عنوان production-ready گزارش نکن.
- ❌ هیچ volume یا network production را حذف نکن.
- ❌ secret را در command-line، log، artifact یا report چاپ نکن.
- ❌ `set -x` یا `bash -x` برای shell دارای secret اجرا نکن.
- ❌ فایل decrypted dump را در artifact آپلود نکن.
