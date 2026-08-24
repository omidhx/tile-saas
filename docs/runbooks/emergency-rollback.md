# Emergency Rollback

> **Severity:** SEV-1 یا SEV-2 (بسته به impact)
> **RTO Target:** ۳۰ دقیقه
>
> **Runbook:** برگرداندن deployment به حالت قبلی در صورت bad deployment یا
> باگ بحرانی پس از release.

---

## ۱. Trigger Conditions

- بعد از deployment، 5xx rate > 5% در ۵ دقیقه.
- بعد از deployment، /api/ready شروع به fail کردن می‌کند.
- باگ بحرانی کشف شده (مثلاً همه‌ی کاربران نمی‌توانند login کنند).
- Migration شکسته است و schema را خراب کرده.

---

## ۲. تصمیم: Rollback یا Hotfix؟

| وضعیت | اقدام |
|---|---|
| Bad deployment + باگ سریع قابل fix | **Hotfix** — fix کن و deploy کن |
| Bad deployment + fix سخت یا طولانی | **Rollback** — به commit قبلی برگرد |
| Bad migration (schema تغییر کرده) | **Rollback + Migration Recovery** — نیاز به schema fix |
| فقط چند صفحه خراب | **Hotfix** — rollback کامل لازم نیست |

---

## ۳. Rollback Procedure (Docker Compose)

### ۳.۱. شناسایی commit قبلی (سالم)

```bash
ssh root@vps
cd /opt/tile-saas

# لیست کامیت‌های اخیر
git log --oneline -10

# آخرین commit شناخته‌شده‌ی سالم را پیدا کن
# مثلاً: اگر HEAD = abc1234 مشکل دارد، به abc1234~1 برگرد
ROLLBACK_COMMIT="<commit-sha>"
echo "Rolling back to: ${ROLLBACK_COMMIT}"
```

### ۳.۲. توقف application

```bash
docker compose stop web worker-expire worker-outbox worker-housekeeping
```

### ۳.۳. Checkout commit سالم

```bash
git fetch origin
git checkout "${ROLLBACK_COMMIT}"
# یا اگر می‌خواهی روی main برگردی:
# git revert HEAD  # یک commit جدید می‌سازد که تغییرات را برمی‌گرداند
```

### ۳.۴. Rebuild و restart

```bash
docker compose build --no-cache web
docker compose up -d web worker-expire worker-outbox worker-housekeeping
```

### ۳.۵. Verify

```bash
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
curl -s http://localhost:3000/api/health

# Smoke test
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health
# انتظار: 200

# بررسی Sentry برای خطاهای جدید
```

---

## ۴. Migration Rollback Strategy

### ۴.۱. سیاست Migration

مهاجرت‌های این پروژه **forward-only** هستند — هیچ migration rollback
(میگرشن معکوس) وجود ندارد. این طراحی عمدی است:

- هر migration فقط `CREATE TABLE IF NOT EXISTS` یا `CREATE OR REPLACE FUNCTION` می‌کند.
- Schema از بین نمی‌رود با migration جدید.
- اگر migration یک column اضافه کرده و اپ قدیمی با آن کار نمی‌کند، rollback
  application کافی است (column اضافی مشکل ایجاد نمی‌کند).

### ۴.۲. اگر Migration Schema را خراب کرده

```bash
# بررسی وضعیت migrationها
docker compose exec -T postgres psql -U postgres -d tile_saas -c \
  "SELECT * FROM _migrations ORDER BY id;"

# اگر migration آخر اجرا شده ولی schema خراب کرده:
# ۱. Application را به commit قبل از migration برگردان (rollback code)
# ۲. Migration record را حذف کن (تا دوباره اجرا نشود):
docker compose exec -T postgres psql -U postgres -d tile_saas -c \
  "DELETE FROM _migrations WHERE id = <bad-migration-id>;"

# ۳. اگر migration اشیاء خراب ساخته، دستی پاک کن:
# مثلاً اگر یک column اضافه کرده:
# docker compose exec -T postgres psql -U postgres -d tile_saas -c \
#   "ALTER TABLE <table> DROP COLUMN IF EXISTS <bad-column>;"

# ۴. Application را restart کن
docker compose restart web
```

### ۴.۳. اگر Migration Roll Forward Needed

اگر commit قدیمی migration جدیدی ندارد که commit فعلی دارد:

```bash
# بعد از rollback code، migrationهای جدید را apply کن:
cd web
DATABASE_URL="postgresql://postgres:pw@localhost:5432/tile_saas" \
  AUTH_SECRET="${AUTH_SECRET}" \
  NODE_PATH="$(pwd)/node_modules" \
  node --import tsx ../db/migrations/apply.ts
cd ..
```

---

## ۵. Post-Rollback Checklist

```text
[ ] Commit قبلی (سالم) checkout شده
[ ] Docker image rebuild شده
[ ] /api/health → 200
[ ] /api/ready → 200
[ ] Login کار می‌کند (manual test)
[ ] /staff/catalog داده نشان می‌دهد
[ ] Sentry خطای جدید ندارد
[ ] Workers running (docker compose ps)
[ ] Caddy ترافیک را route می‌کند
[ ] Postmortem scheduled (if SEV-1/2)
[ ] Git: revert commit یا checkout بررسی شده
```

---

## ۶. ارتباط با سایر Runbookها

| Runbook | ارتباط |
|---|---|
| `dr-database-outage.md` | اگر rollback شامل restore DB هم باشد |
| `disk-pressure-and-cleanup.md` | اگر rebuild به فضای دیسک نیاز دارد |
| `secret-rotation.md` | اگر rollback شامل secret change باشد |
| `../RUNBOOK_MIGRATION.md` | مرجع migration apply/rollback |
