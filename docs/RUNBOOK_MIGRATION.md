# RUNBOOK — اعمالِ Migration روی Production

> این runbook برای زمانی است که می‌خواهی migration (به‌خصوص 0004) را روی
> دیتابیسِ production اعمال کنی. قبل از شروع، حتماً یک بکاپ بگیر (نگاه کن به
> [BACKUPS.md](BACKUPS.md)).

## ۱. قبل از شروع

### ۱.۱. پیش‌نیازها
- دسترسیِ SSH به VPS ایران
- دسترسیِ psql به دیتابیسِ production با کاربرِ `db_owner` (نه `app_user`)
- بکاپِ تازه از دیتابیس (با `pg_dump`)
- اپ در حالتِ maintenance یا زمانِ کم‌ترافیک (مثلاً ۳ شب)

### ۱.۲. تستِ محلی اول
قبل از اجرا روی production، حتماً روی یک کپی از داده‌ی production تست کن:

```bash
# روی محیطِ dev با کپیِ داده‌ی prod:
createdb tile_prod_copy
pg_dump "$PROD_DATABASE_URL" | psql tile_prod_copy
cd web && DATABASE_URL=tile_prod_copy npm run migrate
# اگر خطا داد، اصلاح کن و دوباره
```

یا با PGlite (بدون نیاز به نصب PostgreSQL):

```bash
cd web && npm run test:migration
# این اسکریپت migration 0004 را روی PGlite (PG در WASM) اجرا می‌کند و
# اثبات می‌کند که CREATE OR REPLACE + assertion درست کار می‌کنند.
```

## ۲. اجرای migration روی production

### ۲.۱. با apply.ts (توصیه‌شده)

```bash
# روی VPS:
cd /srv/tile/web
npm run migrate
# این دستور:
#   ۱. جدول _migrations را چک می‌کند (اگر نبود، 0002 را اجرا می‌کند)
#   ۲. migrationهای اجرا‌نشده را شناسایی می‌کند
#   ۳. هر کدام را در یک تراکنش اجرا می‌کند
#   ۴. در صورت شکست، تراکنش rollback می‌شود و migration بعدی اجرا نمی‌شود
```

### ۲.۲. با psql دستی (اگر apply.ts در دسترس نیست)

```bash
# اتصال به DB با نقشِ db_owner (نه app_user، نه superuser)
psql "$DATABASE_URL" -f db/migrations/0004_lock_definer_search_path.sql
# اگر خطا داد، تراکنش rollback شده و چیزی تغییر نکرده.
```

### ۲.۳. در Docker Compose

```bash
docker compose exec web node --import tsx ../db/migrations/apply.ts
```

## ۳. اعتبارسنجی بعد از اجرا

بعد از اجرای migration 0004، باید آن را با کوئریِ زیر تأیید کنی:

```sql
SELECT proname, proconfig
FROM pg_proc
WHERE proname IN ('user_contexts', 'expire_due_reservations',
                  'claim_pending_notifications', 'finish_notification')
ORDER BY proname;
```

**خروجیِ مورد انتظار:** هر چهار ردیف باید `proconfig` برابر با
`{search_path=public, pg_temp}` داشته باشند. اگر NULL بود یا چیز دیگری بود،
migration درست اجرا نشده.

### ۳.۱. تستِ functional — لاگین کار می‌کند؟

بعد از migration، لاگین را تست کن:

```bash
# با curl:
curl -X POST https://your-domain/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"09120000000","password":"test"}'
# باید ۴۰۱ بدهد (اگر رمز درست نباشد) یا ۲۰۰ (اگر درست باشد).
# اگر ۵۰۰ داد، یعنی GRANT EXECUTE از دست رفته — پایین را ببین.
```

## ۴. عیب‌یابی

### ۴.۱. خطای `relation "_migrations" does not exist`
یعنی migration 0002 هنوز اجرا نشده. `apply.ts` باید خودکار آن را اجرا کند، ولی اگر
دستی اجرا کردی، اول 0002 را بزن.

### ۴.۲. خطای `permission denied for table _rate_limit_hits`
یعنی `app_user` به جدول دسترسی ندارد. migration 0003 باید GRANT صریح بزند، ولی
اگر نقشِ `app_user` بعد از migration ساخته شده، GRANT اجرا نشده. اجرا کن:

```sql
GRANT SELECT, INSERT, DELETE ON _rate_limit_hits TO app_user;
GRANT USAGE, SELECT ON SEQUENCE _rate_limit_hits_id_seq TO app_user;
```

### ۴.۳. خطای `permission denied for function user_contexts`
یعنی GRANT EXECUTE روی تابع از دست رفته. این نباید با `CREATE OR REPLACE` اتفاق
بیفتد، ولی اگر `DROP FUNCTION` شده باشد، باید GRANT را از نو بزنی:

```sql
GRANT EXECUTE ON FUNCTION user_contexts(UUID) TO app_user;
GRANT EXECUTE ON FUNCTION expire_due_reservations() TO app_user;
GRANT EXECUTE ON FUNCTION claim_pending_notifications(INT, INT) TO app_user;
GRANT EXECUTE ON FUNCTION finish_notification(UUID, BOOLEAN, INT) TO app_user;
```

### ۴.۴. خطای assertion `search_path قفل نشده`
یعنی `CREATE OR REPLACE` اجرا نشده یا شکست خورده. می‌توانی آن را با psql دستی اجرا کنی:

```bash
psql "$DATABASE_URL" -c "
CREATE OR REPLACE FUNCTION user_contexts(p_user_id UUID)
RETURNS TABLE (tenant_id UUID, tenant_name TEXT, agent_account_id UUID, agent_legal_name TEXT, role TEXT,
               can_manage_access BOOLEAN, allowed_pages TEXT[],
               assigned_staff_name TEXT, assigned_staff_phone TEXT, currency_unit TEXT)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, pg_temp
AS \$\$
    SELECT t.id, t.name, aa.id, aa.legal_name, tm.role, tm.can_manage_access, tm.allowed_pages,
           su.full_name, su.phone, t.currency_unit
    FROM tenant_membership tm
    JOIN tenant t ON t.id = tm.tenant_id AND t.is_active
    LEFT JOIN agent_account_user aau ON aau.user_id = tm.user_id AND aau.tenant_id = tm.tenant_id
    LEFT JOIN agent_account aa ON aa.id = aau.agent_account_id AND aa.is_active
    LEFT JOIN app_user su ON su.id = aa.assigned_staff_user_id
    WHERE tm.user_id = p_user_id AND tm.is_active
\$\$;
"
```

## ۵. Rollback

اگر migration خرابی ایجاد کرد، می‌توانی به حالتِ قبل برگردی:

### ۵.۱. با بکاپ
```bash
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" < backup.sql
```

### ۵.۲. rollback دستیِ migration 0004 (بدون بازگشتِ کلِ DB)
توابع را با حالتِ قدیمی (بدون search_path) بازنویسی کن. ولی این کار غیرمعمول است —
بهتر است با search_path بمانی چون امن‌تر است. اگر migration 0004 خرابی ایجاد کرده،
احتمالاً مشکل از جای دیگری است (نه از search_path).

## ۶. بعد از موفقیت

- در جدولِ `_migrations` ردیف جدید باید ثبت شده باشد:
  ```sql
  SELECT * FROM _migrations ORDER BY id DESC LIMIT 5;
  ```
- در Sentry نباید خطای جدیدی باشد.
- لاگین، رزرو، و worker outbox باید همچنان کار کنند.

## ۷. چک‌لیستِ نهایی

- [ ] بکاپ گرفته شد
- [ ] تستِ محلی با `npm run test:migration` سبز شد
- [ ] تستِ محلی با کپیِ داده‌ی prod سبز شد
- [ ] migration با `apply.ts` (یا psql دستی) اجرا شد
- [ ] کوئریِ اعتبارسنجی `proconfig` هر چهار تابع را `search_path=public, pg_temp` نشان داد
- [ ] لاگین تست شد (۲۰۰ یا ۴۰۱، نه ۵۰۰)
- [ ] worker outbox تست شد (پیامک ارسال می‌شود)
- [ ] در Sentry خطای جدیدی نیست
- [ ] در `_migrations` ردیفِ جدید ثبت شد
