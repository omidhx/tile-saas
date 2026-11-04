# Disk Pressure & Cleanup

> **Severity:** SEV-2 (Major) اگر disk > ۹۰٪
> **Severity:** SEV-3 (Minor) اگر disk > ۸۰٪
>
> **Runbook:** آزادسازی امن فضای دیسک بدون پاک شدن داده‌ی واقعی.

---

## ۱. Trigger Conditions

- Alert: disk usage > ۸۰% (SEV-3) یا > ۹۰% (SEV-2).
- `df -h` نشان می‌دهد دیسک پر است.
- Docker خطای "no space left on device" می‌دهد.
- PostgreSQL خطای "could not extend file" می‌دهد.
- Backup script با "disk full" fail می‌شود.

---

## ۲. Diagnosis

### ۲.۱. بررسی فضای دیسک

```bash
ssh root@vps
df -h

# پیدا کردن بزرگ‌ترین consumerها
du -sh /opt/tile-saas/* 2>/dev/null | sort -rh | head -10
du -sh /var/lib/docker/* 2>/dev/null | sort -rh | head -10
du -sh /var/log/* 2>/dev/null | sort -rh | head -5
```

### ۲.۲. بررسی Docker

```bash
# Docker disk usage
docker system df

# Docker images (dangling)
docker images -f "dangling=true"

# Docker containers (stopped)
docker ps -a --filter "status=exited"

# Docker volumes (unused)
docker volume ls -f "dangling=true"
```

### ۲.۳. بررسی backup‌های قدیمی

```bash
ls -lh backups/daily/*.gpg
ls -lh backups/uploads/*.gpg
du -sh backups/
```

### ۲.۴. بررسی logs

```bash
# Docker logs size
docker compose logs --no-color web 2>&1 | wc -c
docker compose logs --no-color postgres 2>&1 | wc -c

# Caddy logs
du -sh /opt/tile-saas/caddy-data/ 2>/dev/null || true
```

---

## ۳. Cleanup Actions (به ترتیب امنیت)

### ۳.۱. Docker cleanup (امن — بدون داده‌ی تولیدی)

```bash
# حذف dangling images (build cache قدیمی)
docker image prune -f

# حذف stopped containers
docker container prune -f

# حذف unused networks
docker network prune -f

# حذف build cache
docker builder prune -f

# بررسی فضای آزاد شده
docker system df
df -h
```

### ۳.۲. Backup retention cleanup (امن — فقط backup‌های منقضی)

```bash
cd /opt/tile-saas

# بررسی retention policy
grep BACKUP_RETENTION_DAYS .env

# Cleanup expired database backups
bash scripts/cleanup-old-backups.sh

# Cleanup expired uploads backups
bash scripts/cleanup-old-uploads-backups.sh

# بررسی فضای آزاد شده
du -sh backups/
df -h
```

### ۳.۳. Orphan upload files cleanup (امن — فقط فایل‌های بدون reference در DB)

```bash
cd /opt/tile-saas/web

# Dry-run first (بدون حذف)
DATABASE_URL="postgresql://postgres:pw@localhost:5432/tile_saas" \
  node --import tsx scripts/cleanup-orphan-uploads.ts --max-days=7
# بررسی خروجی — اگر فایل‌های orphan زیاد هستند

# اگر تأیید شد، با --commit اجرا کن:
DATABASE_URL="postgresql://postgres:pw@localhost:5432/tile_saas" \
  node --import tsx scripts/cleanup-orphan-uploads.ts --max-days=7 --commit

cd ..
df -h
```

### ۳.۴. Docker logs rotation (امن — فقط logs قدیمی)

```bash
# Docker log files می‌توانند بزرگ شوند
# بررسی:
docker inspect $(docker compose ps -q web) | grep -A5 "LogConfig"

# تنظیم log rotation (در docker-compose.yml یا daemon.json):
# LogConfig:
#   max-size: "10m"
#   max-file: "3"

# اگر log file بزرگ شده، container را restart کن (log را truncate می‌کند):
docker compose restart web
# ⚠️ این restart کوتاه است (~۳۰ ثانیه) ولی کاربران ممکن است تأثیر ببینند

df -h
```

### ۳.۵. PostgreSQL WAL cleanup (با احتیاط)

```bash
# بررسی WAL size
docker compose exec -T postgres psql -U postgres -c \
  "SELECT pg_size_pretty(sum(size)) FROM pg_stat_wal;"

# اگر WAL بزرگ است، checkpoint بزن:
docker compose exec -T postgres psql -U postgres -c "CHECKPOINT;"

# بررسی pg_wal directory
docker compose exec -T postgres du -sh /var/lib/postgresql/data/pg_wal/

df -h
```

### ۳.۶. Caddy logs cleanup (امن)

```bash
# Caddy logs در caddy-data volume
docker compose exec -T caddy ls -la /data/
docker compose exec -T caddy du -sh /data/

# اگر بزرگ شده:
docker compose exec -T caddy rm -rf /data/logs/old/ 2>/dev/null || true

df -h
```

---

## ۴. موارد ممنوع (هرگز پاک نکن)

| مورد | دلیل |
|---|---|
| ❌ `pgdata` volume | داده‌ی دیتابیس production |
| ❌ `uploads` volume | فایل‌های آپلودشده‌ی کاربران |
| ❌ `backups/daily/*.gpg` (درون retention) | backup‌های معتبر |
| ❌ `backups/uploads/*.gpg` (درون retention) | backup‌های معتبر |
| ❌ `backups/status/*.json` | فایل‌های status برای metrics |
| ❌ `.env` | secret‌های production |
| ❌ `web/node_modules` | dependency‌ها — با npm ci بازسازی می‌شود ولی زمان‌بر است |

---

## ۵. Post-Cleanup Checklist

```text
[ ] Docker dangling images removed
[ ] Docker stopped containers removed
[ ] Docker build cache pruned
[ ] Expired backups cleaned (cleanup-old-backups.sh)
[ ] Expired uploads backups cleaned (cleanup-old-uploads-backups.sh)
[ ] Orphan upload files cleaned (cleanup-orphan-uploads.ts --commit)
[ ] Docker logs rotated (if needed)
[ ] PostgreSQL WAL checkpointed (if needed)
[ ] Caddy logs cleaned (if needed)
[ ] df -h shows healthy disk usage
[ ] /api/health → 200 (verify app still works)
[ ] /api/ready → 200 (verify DB still works)
```

---

## ۶. Prevention

برای جلوگیری از تکرار disk pressure:

### ۶.۱. تنظیم Docker log rotation

در `docker-compose.yml` یا `/etc/docker/daemon.json`:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
```

### ۶.۲. Cron برای cleanup

```cron
# روزانه ساعت ۰۴:۳۰ IRST
30 00 * * * cd /opt/tile-saas && bash scripts/cleanup-old-backups.sh >> /var/log/tile-saas-cleanup.log 2>&1
30 00 * * * cd /opt/tile-saas && bash scripts/cleanup-old-uploads-backups.sh >> /var/log/tile-saas-cleanup.log 2>&1

# هفتگی orphan cleanup (یکشنبه ۰۶:۰۰ IRST)
00 02 * * 0 cd /opt/tile-saas/web && DATABASE_URL=postgres://... node --import tsx scripts/cleanup-orphan-uploads.ts --max-days=30 --commit >> /var/log/tile-saas-cleanup.log 2>&1
```

### ۶.۳. Monitoring

- Alert: disk usage > ۸۰% → SEV-3
- Alert: disk usage > ۹۰% → SEV-2
- `/api/metrics` → `backup_age_seconds` و `uploads_backup_age_seconds` را مانیتور کن.

---

## ۷. ارتباط با سایر Runbookها

| Runbook | ارتباط |
|---|---|
| `dr-database-outage.md` | اگر disk full باعث DB outage شده |
| `dr-uploads-recovery.md` | اگر uploads volume تحت تأثیر قرار گرفته |
| `incident-classification.md` | برای severity assignment |
