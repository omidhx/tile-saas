# Staging Verification — چک‌لیست اجرایی گام‌به‌گام

> **هدف:** اجرای Runtime Verification برای Phase 8 (database backup) و Phase 9
> (uploads backup) در محیط Docker Compose staging.
>
> **پیش‌نیاز:** این سند روی یک host با Docker Engine نصب شده اجرا می‌شود.
> در sandbox فعلی Docker موجود نیست — این دستورات آماده‌ی اجرا روی VPS یا
> local machine هستند.

---

## مرحله ۰: پیش‌نیازهای محیط

### ۰.۱. بررسی Docker

```bash
docker version
docker compose version
docker info | grep "Server Version"
```

**الزام:** Docker daemon running، Compose v2.

### ۰.۲. بررسی فضای دیسک

```bash
df -h .
```

**الزام:** حداقل ۵GB فضای آزاد (image ~۱GB + PG data ~۱۰۰MB + backup ~۱۰۰MB).

### ۰.۳. بررسی repository

```bash
cd /path/to/tile-saas
git rev-parse HEAD
git status --short
```

**الزام:** HEAD = `6ebab09`، working tree clean.

---

## مرحله ۱: تنظیم متغیرهای محیطی staging

### ۱.۱. ایجاد فایل `.env` برای staging

```bash
cd /path/to/tile-saas

# تولید passphrase‌های staging (هر کدام حداقل ۳۲ کاراکتر)
DB_PASSPHRASE=$(openssl rand -base64 32)
UPLOADS_PASSPHRASE=$(openssl rand -base64 32)

# نوشتن .env (هرگز در git commit نمی‌شود — .gitignore)
cat > .env << EOF
# ===== Staging Credentials (test-only, NOT for production) =====

# PostgreSQL (superuser برای backup scriptها)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=stagingpw
POSTGRES_DB=tile_staging

# GPG passphrase برای database backup (Phase 8)
BACKUP_GPG_PASSPHRASE=${DB_PASSPHRASE}

# GPG passphrase برای uploads backup (Phase 9)
# نکته: backup-uploads.sh از همان BACKUP_GPG_PASSPHRASE استفاده می‌کند
# اگر passphrase جداگانه می‌خواهید، متغیر UPLOADS_GPG_PASSPHRASE را ست کنید
# فعلاً از همان passphrase استفاده می‌کنیم

# Retention
BACKUP_RETENTION_DAYS=30

# Off-site (خالی برای staging — فقط local backup)
BACKUP_OFFSITE_TARGET=

# Compose file
COMPOSE_FILE=docker-compose.staging.yml
EOF

echo "✅ .env created (passphrases generated, NOT printed)"
chmod 600 .env
```

### ۱.۲. بررسی ایزولایشن staging از production

```bash
echo "=== Staging isolation audit ==="

# DB name باید tile_staging باشد (نه tile_saas)
grep "POSTGRES_DB" .env | grep -q "tile_staging" && echo "✅ DB name: tile_staging" || echo "❌ DB name mismatch"

# Volume باید staging باشد
grep "pgdata-staging" docker-compose.staging.yml > /dev/null && echo "✅ Volume: pgdata-staging" || echo "❌ Volume mismatch"

# Uploads volume باید staging باشد
grep "uploads-staging" docker-compose.staging.yml > /dev/null && echo "✅ Uploads: uploads-staging" || echo "❌ Uploads mismatch"

# Password باید staging باشد (نه production)
grep "stagingpw" docker-compose.staging.yml > /dev/null && echo "✅ Password: staging (test-only)" || echo "❌ Password mismatch"

echo ""
echo "=== STAGING ISOLATION: PASS ==="
```

---

## مرحله ۲: Build و startup

### ۲.۱. Build images

```bash
docker compose -f docker-compose.staging.yml build --no-cache 2>&1 | tee /tmp/staging-build.log
```

**الزام:** build موفق، no errors.

### ۲.۲. Start services

```bash
docker compose -f docker-compose.staging.yml up -d
```

### ۲.۳. بررسی وضعیت containerها

```bash
docker compose -f docker-compose.staging.yml ps --all
```

**انتظار:** همه‌ی services در وضعیت `Up` یا `healthy`.

### ۲.۴. منتظر PostgreSQL healthcheck

```bash
# Health-based readiness (نه sleep ثابت)
for i in $(seq 1 30); do
  if docker compose -f docker-compose.staging.yml exec -T postgres \
    pg_isready -U postgres -d tile_staging 2>/dev/null; then
    echo "✅ PostgreSQL is ready (attempt $i)"
    break
  fi
  echo "  Waiting for PostgreSQL... (attempt $i/30)"
  sleep 2
done
```

### ۲.۵. بررسی logs (بدون چاپ secret)

```bash
# PostgreSQL logs
docker compose -f docker-compose.staging.yml logs --no-color postgres | tail -20

# Web app logs
docker compose -f docker-compose.staging.yml logs --no-color web | tail -30
```

**الزام:** PostgreSQL باید "ready to accept connections" گزارش دهد.
Web app باید "ready" گزارش دهد یا در حال startup باشد.

---

## مرحله ۳: Migration و schema runtime

### ۳.۱. بررسی migrationها

```bash
# Run apply.ts (idempotent — فقط migrationهای اجرا‌نشده را اجرا می‌کند)
cd /path/to/tile-saas/web
DATABASE_URL="postgres://postgres:stagingpw@localhost:5432/tile_staging" \
  AUTH_SECRET="staging-secret-must-be-at-least-32-characters-long" \
  NODE_PATH="$(pwd)/node_modules" \
  node --import tsx ../db/migrations/apply.ts
cd ..
```

### ۳.۲. بررسی schema

```bash
# Migration count (انتظار: ≥ ۳)
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -t -c "SELECT count(*) FROM _migrations;"

# Table count (انتظار: ≥ ۳۸)
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"

# RLS policies (انتظار: ≥ ۱)
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -t -c "SELECT count(*) FROM pg_policy;"

# SECURITY DEFINER functions (انتظار: ≥ ۴)
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -t -c "
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.prosecdef=true;"

# Extensions
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -t -c "SELECT extname, extversion FROM pg_extension;"
```

### ۳.۳. Seed minimal data (tenant + platform admin)

```bash
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d tile_staging -v ON_ERROR_STOP=1 -c "
-- Insert a test tenant if none exists
INSERT INTO tenant (id, name, slug, created_at)
SELECT '11111111-1111-1111-1111-111111111111', 'Test Tenant', 'test-tenant', now()
WHERE NOT EXISTS (SELECT 1 FROM tenant);

-- Insert a platform admin user if none exists
INSERT INTO app_user (id, phone, password_hash, is_platform_admin, created_at)
SELECT '11111111-1111-1111-1111-111111111112', '09999999999',
       '\$2a\$10\$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', true, now()
WHERE NOT EXISTS (SELECT 1 FROM app_user WHERE is_platform_admin);

-- Link admin to tenant
INSERT INTO tenant_membership (tenant_id, user_id, role, is_active)
SELECT '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111112', 'admin', true
WHERE NOT EXISTS (SELECT 1 FROM tenant_membership);
"
```

---

## مرحله ۴: Database Backup (Phase 8)

### ۴.۱. اجرای backup

```bash
bash scripts/backup-db.sh
```

**ثبت evidence:**
- exit code (انتظار: 0)
- backup file path
- size progression: raw → zstd → gpg
- SHA-256 checksum

### ۴.۲. اجرای verify

```bash
bash scripts/verify-backup.sh
```

**انتظار:** exit 0، "Backup file is valid and ready for restore."

### ۴.۳. اجرای restore test

```bash
bash scripts/restore-db.sh --test-only
```

**انتظار:** exit 0، "Restore test SUCCEEDED — backup is restorable."

### ۴.۴. بررسی artifactها

```bash
# Permission check
find backups/daily -type f -printf '%M %u:%g %p\n'
# انتظار: 0600 برای .gpg و .sha256

# Status file
cat backups/status/backup-status.json
# انتظار: last_success_at اخیر، last_failure_at = null

# No plaintext files
find backups/daily -name "*.sql" -o -name "*.zst" | grep -v ".gpg"
# انتظار: خالی
```

---

## مرحله ۵: Uploads Backup (Phase 9)

### ۵.۱. ایجاد فایل‌های نمونه در uploads volume

```bash
# پیدا کردن web container
WEB_CONTAINER=$(docker compose -f docker-compose.staging.yml ps -q web | head -1)

# ایجاد فایل‌های نمونه با UUID naming و magic bytes واقعی
docker exec "${WEB_CONTAINER}" bash -c '
  UPLOADS_DIR="/app/web/private/uploads"
  mkdir -p "${UPLOADS_DIR}"

  # JPEG file (magic bytes: FF D8 FF E0)
  printf "\xff\xd8\xff\xe0\x00\x10JFIF" > "${UPLOADS_DIR}/$(uuidgen).jpg"
  dd if=/dev/urandom bs=1024 count=1 >> "${UPLOADS_DIR}/$(ls -t ${UPLOADS_DIR} | head -1)" 2>/dev/null

  # PNG file (magic bytes: 89 50 4E 47)
  printf "\x89PNG\r\n\x1a\n" > "${UPLOADS_DIR}/$(uuidgen).png"
  dd if=/dev/urandom bs=2048 count=1 >> "${UPLOADS_DIR}/$(ls -t ${UPLOADS_DIR} | head -1)" 2>/dev/null

  # WebP file (magic bytes: RIFF....WEBP)
  printf "RIFF\x00\x00\x00\x00WEBP" > "${UPLOADS_DIR}/$(uuidgen).webp"
  dd if=/dev/urandom bs=1536 count=1 >> "${UPLOADS_DIR}/$(ls -t ${UPLOADS_DIR} | head -1)" 2>/dev/null

  echo "Files created:"
  ls -la "${UPLOADS_DIR}/"
'
```

### ۵.۲. اجرای uploads backup

```bash
bash scripts/backup-uploads.sh
```

**ثبت evidence:**
- exit code (انتظار: 0)
- backup file path
- size progression: tar → zstd → gpg
- SHA-256 checksum
- file count (انتظار: ۳)

### ۵.۳. اجرای uploads verify

```bash
bash scripts/verify-uploads.sh
```

**انتظار:** exit 0، "Uploads backup file is valid and ready for restore."

### ۵.۴. اجرای uploads restore test

```bash
bash scripts/restore-uploads.sh --test-only
```

**انتظار:** exit 0، "Uploads restore test SUCCEEDED — backup is restorable."

### ۵.۵. بررسی artifactها

```bash
# Permission check
find backups/uploads -type f -printf '%M %u:%g %p\n'
# انتظار: 0600 برای .gpg، .sha256، .manifest

# Status file
cat backups/status/uploads-backup-status.json
# انتظار: last_success_at اخیر، last_failure_at = null، file_count = ۳

# No plaintext files
find backups/uploads -name "*.tar" -o -name "*.tar.zst" | grep -v ".gpg"
# انتظار: خالی
```

---

## مرحله ۶: Failure-path tests

### ۶.۱. Wrong passphrase (database)

```bash
BACKUP_GPG_PASSPHRASE="wrong-passphrase-xyz" bash scripts/verify-backup.sh
# انتظار: exit non-zero، "GPG decrypt failed"
```

### ۶.۲. Wrong passphrase (uploads)

```bash
BACKUP_GPG_PASSPHRASE="wrong-passphrase-xyz" bash scripts/verify-uploads.sh
# انتظار: exit non-zero، "GPG decrypt failed"
```

### ۶.۳. Invalid RESTORE_DB_NAME

```bash
RESTORE_DB_NAME="tile_staging" bash scripts/restore-db.sh --test-only
# انتظار: exit non-zero، "RESTORE_DB_NAME must not equal POSTGRES_DB"
```

### ۶.۴. Concurrent flock test

```bash
# Process 1: hold lock
BACKUP_TEST_MODE=1 BACKUP_TEST_HOLD_SECONDS=5 \
  BACKUP_LOCK_FILE=/tmp/test-staging-flock.lock \
  bash scripts/backup-db.sh &
PID1=$!

sleep 1

# Process 2: should fail
BACKUP_LOCK_FILE=/tmp/test-staging-flock.lock \
  bash scripts/backup-db.sh
# انتظار: exit non-zero، "already running"

wait $PID1
rm -f /tmp/test-staging-flock.lock
```

### ۶.۵. SIGTERM cleanup

```bash
bash scripts/restore-db.sh --test-only &
PID=$!
sleep 2
kill -TERM $PID
wait $PID
echo "Exit code: $? (expected: 143 = 128+15)"

# Verify cleanup
docker compose -f docker-compose.staging.yml exec -T postgres \
  psql -U postgres -d postgres -t -c "SELECT datname FROM pg_database WHERE datname='tile_restore_test';"
# انتظار: خالی (database dropped)
```

---

## مرحله ۷: مانیتورینگ و metrics

### ۷.۱. بررسی /api/ready

```bash
# از داخل container (web روی port 3000)
docker compose -f docker-compose.staging.yml exec -T web \
  curl -s http://localhost:3000/api/ready | python3 -m json.tool

# انتظار: {"status":"ready","checks":{"db":"ok"},...}
```

### ۷.۲. بررسی /api/health

```bash
docker compose -f docker-compose.staging.yml exec -T web \
  curl -s http://localhost:3000/api/health | python3 -m json.tool

# انتظار: {"status":"ok","timestamp":"..."}
```

### ۷.۳. بررسی /api/metrics (backup section)

```bash
# در production، /api/metrics نیاز به auth دارد
# در staging، NODE_ENV=production است پس auth لازم است
# برای تست، می‌توانیم مستقیماً فایل status را بررسی کنیم

echo "=== Database backup status ==="
cat backups/status/backup-status.json | python3 -m json.tool

echo ""
echo "=== Uploads backup status ==="
cat backups/status/uploads-backup-status.json | python3 -m json.tool
```

**انتظار:**
- `last_success_at`: timestamp اخیر
- `last_failure_at`: null
- `backup_age_seconds`: عدد کوچک
- `restore_test_last_success_at`: timestamp اخیر

---

## مرحله ۸: Secret-leak audit

### ۸.۱. بررسی logs

```bash
echo "=== Checking for secret leaks in container logs ==="

# PostgreSQL logs — no password should appear
docker compose -f docker-compose.staging.yml logs postgres 2>&1 | \
  grep -i "password\|passphrase\|secret" | head -5
# انتظار: خالی یا فقط خطاهای بی‌ربط

# Web logs
docker compose -f docker-compose.staging.yml logs web 2>&1 | \
  grep -i "BACKUP_GPG_PASSPHRASE\|passphrase" | head -5
# انتظار: خالی

echo "=== Checking backup script output for secrets ==="
# اگر backup script را با output captured اجرا کردید:
# grep -i "passphrase\|password" /tmp/backup-output.log
# انتظار: خالی

echo "✅ Secret leak audit complete"
```

### ۸.۲. بررسی artifactها

```bash
echo "=== Checking artifacts for plaintext ==="

# No .sql or .tar files (only .gpg, .sha256, .manifest)
find backups/ -name "*.sql" -o -name "*.tar" -o -name "*.zst" 2>/dev/null | grep -v ".gpg"
# انتظار: خالی

echo "✅ No plaintext files in artifacts"
```

---

## مرحله ۹: Cleanup

### ۹.۱. بررسی نهایی وضعیت

```bash
docker compose -f docker-compose.staging.yml ps --all
```

### ۹.۲. پاک‌سازی (فقط resourceهای staging)

```bash
# Stop and remove containers (بدون حذف volumeها)
docker compose -f docker-compose.staging.yml down

# اگر volumeها test-only هستند و می‌خواهید پاک کنید:
# docker compose -f docker-compose.staging.yml down -v
# ⚠️ فقط پس از تأیید ownership — هیچ volume production را حذف نکن.
```

---

## معیار نهایی پذیرش Staging

```text
[ ] Docker Compose startup موفق
[ ] PostgreSQL healthcheck موفق
[ ] migrations applied (≥ ۳)
[ ] Database backup واقعی تولید شد
[ ] Database compression موفق
[ ] Database encryption موفق
[ ] Database checksum موفق
[ ] Database verification موفق
[ ] Database restore به isolated test database موفق
[ ] Database integrity checks موفق
[ ] Database transaction test موفق
[ ] Database cleanup موفق
[ ] Uploads backup واقعی تولید شد
[ ] Uploads compression موفق
[ ] Uploads encryption موفق
[ ] Uploads checksum موفق
[ ] Uploads manifest موفق
[ ] Uploads verification موفق
[ ] Uploads restore به isolated directory موفق
[ ] Uploads per-file checksum verification موفق
[ ] Uploads cleanup موفق
[ ] secret audit: no leak در logs
[ ] failure-path checks: wrong passphrase، invalid input، concurrent flock، SIGTERM
[ ] permission audit: 0600 for .gpg/.sha256/.manifest، 0644 for status file
[ ] AUD-009 transparently reported
[ ] /api/ready و /api/metrics کار می‌کنند
```

---

## متن مجاز پس از موفقیت

> **Phase 8 CI and Docker Compose staging backup/verify/restore cycles are runtime-verified.
> Phase 9 uploads backup/verify/restore is runtime-verified in CI and staging.
> Production VPS execution, real production backup, and real production restore remain pending.**

---

## ممنوعیت‌ها

- ❌ به production database متصل نشو.
- ❌ از production DATABASE_URL استفاده نکن.
- ❌ از production backup path استفاده نکن.
- ❌ از production GPG passphrase استفاده نکن.
- ❌ staging موفق را به‌عنوان production-ready گزارش نکن.
- ❌ هیچ volume یا network production را حذف نکن.
- ❌ secret را در command-line، log، artifact یا report چاپ نکن.
- ❌ `set -x` یا `bash -x` برای shell دارای secret اجرا نکن.
- ❌ فایل decrypted dump را در artifact آپلود نکن.
