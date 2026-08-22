# GO_LIVE — کارهایی که قبل/حین آنلاین‌شدن باید انجام بشه

> این فایل «چک‌لیستِ عملیاتی» است، نه توضیح معماری. هر بند یا یک کارِ انجام‌دادنی است
> یا یک تصمیمِ باز. مرجع استدلال‌ها: `tile-saas-comprehensive-spec.md` (بخش ۳، ۸، ۱۴).
>
> وضعیت کد: v1 فیچرکامل است (ورود موجودی، رزرو→تأیید→حواله→بارگیری، backorder،
> اعلان). چیزی که پایین می‌آید، فاصله‌ی «کد کار می‌کند» تا «سرویسِ زنده» است.

---

## ۰. مسدودکننده‌ها (بدون این‌ها سایت بالا نمی‌آید یا ناامن است)

- [ ] **نقش‌های دیتابیس (حیاتی برای RLS).** اپ **نباید** با superuser یا با مالکِ جدول‌ها وصل شود — هر دو RLS را دور می‌زنند.
  ```sql
  CREATE ROLE db_owner LOGIN PASSWORD '...';   -- فقط migration؛ مالک جدول‌ها
  CREATE ROLE app_user LOGIN PASSWORD '...';   -- اتصال اپ؛ مالک هیچ جدولی نیست
  GRANT USAGE ON SCHEMA public TO app_user;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
  GRANT EXECUTE ON FUNCTION user_contexts(UUID) TO app_user;
  GRANT EXECUTE ON FUNCTION expire_due_reservations() TO app_user;
  GRANT EXECUTE ON FUNCTION claim_pending_notifications(INT, INT) TO app_user;
  GRANT EXECUTE ON FUNCTION finish_notification(UUID, BOOLEAN, INT) TO app_user;
  ```
  > این چهار تابع `SECURITY DEFINER` هستند چون کارشان ذاتاً cross-tenant است
  > (bootstrap هویت و دو worker). بدون این GRANTها، ورود و workerها کار نمی‌کنند.
  بعد از ساخت: با `app_user` تست کن که بدون `app.tenant_id` هیچ ردیفی برنمی‌گردد.
- [ ] **`web/.env`** (gitignored):
  ```
  DATABASE_URL=postgres://app_user:<pw>@localhost:5432/tile   # نقشِ non-superuser
  AUTH_SECRET=<openssl rand -base64 32>    # حداقل ۳۲ کاراکتر — نبودش boot را می‌شکند (fail-loud)
  RATE_LIMIT_BACKEND=memory               # memory=تک-instance (پیش‌فرض) / postgres=multi-instance
  SMS_PROVIDER=<ارائه‌دهنده>            # پیش‌فرض log = فقط چاپ می‌کند (و در production متن سانسور می‌شود)
  SENTRY_DSN=<اختیاری>                  # نبودش یعنی فقط مانیتورینگِ خطا خاموش است، نه کلِ اپ
  ```
  > نمونه‌ی کامل: `.env.example` در ریشه. در Docker: متغیرها از `docker-compose.yml`
  > خوانده می‌شوند — `web/.env` لازم نیست.
- [ ] **HTTPS اجباری.** کوکی نشست در production `Secure` است؛ **روی HTTP لاگین اصلاً کار نمی‌کند.** Caddy/Nginx + Let's Encrypt.
- [ ] **کاربر و کارخانه‌ی اولیه.** هیچ فرم ثبت‌نامی وجود ندارد (عمدی — B2B). اولین tenant/کاربر با SQL ساخته می‌شود: بخش ۶ پایین.

---

## ۱. Reverse proxy (Caddy/Nginx)

- [ ] TLS با Let's Encrypt.
- [ ] **`X-Forwarded-For` را ست کن** — rate limiting IP کلاینت را از همین هدر می‌خواند؛ بدون آن همه‌ی کاربران در یک سطل می‌افتند و یک نفر می‌تواند بقیه را قفل کند.
- [ ] **HSTS در پروکسی** ست شود (عمداً در اپ نگذاشتیم تا dev روی HTTP نشکند).
- [ ] پورت Postgres **هرگز** به اینترنت expose نشود (spec ۳.۴).

## ۲. اجرای اپ

### ۲.۱. دو مسیرِ دیپلوی — فقط یکی را انتخاب کن

**مسیرِ A — Docker Compose (توصیه‌شده):**
```bash
cp .env.example .env      # مقادیر واقعی پر کن
docker compose up -d      # postgres + web + worker-expire + worker-outbox + worker-housekeeping
```
این مسیر خودش همه‌چیز را مدیریت می‌کند — volume، workerها، healthcheck. فقط Caddy/Nginx
جدا برای HTTPS لازم است.

**مسیرِ B — نصبِ مستقیم روی VPS:**
```bash
npm ci && npm run build && npm run start   # پشت PM2/systemd
```
در این مسیر، workerها را با cron اجرا کن (پایین).

### ۲.۲. نکاتِ مشترک

- [ ] ⚠️ **عکس‌های کاتالوگ در `web/public/uploads/` روی دیسک ذخیره می‌شوند** (کاتالوگ تصویری). این پوشه باید روی یک **volume جدا از کدِ دیپلوی‌شونده** باشد (symlink یا bind-mount)، وگرنه هر `npm run build`/دیپلوی عکس‌ها را پاک می‌کند. در git هم ignore شده. اگر عکس‌ها فقط با URLِ خارجی می‌آیند (ستونِ عکسِ اکسل)، این مورد بی‌اثر است.
- [ ] ⚠️ **rate limiter — دو حالت:**
  - `RATE_LIMIT_BACKEND=memory` (پیش‌فرض): سقف در تعداد پروسه‌ها ضرب می‌شود. فقط برای تک-instance.
  - `RATE_LIMIT_BACKEND=postgres`: سقفِ واقعاً global، multi-instance. نیاز به migration `0003_rate_limit_table.sql`. در Docker Compose، پیش‌فرض `postgres` است.
  - **fail policy:** برای auth مسیرها (login/password/reset) fail-closed است — اگر DB پایین باشد، fallback به in-memory می‌زند و سقف را برنمی‌دارد. برای بقیه fail-open است.
- [ ] ⚠️ **تک منبعِ زمان‌بندی** — یا Docker workerها یا cron، نه هر دو. اگر Docker Compose را انتخاب کردی، cronهای پایین را روشن نکن. اگر cron را انتخاب کردی، `worker-expire`/`worker-outbox` سرویس‌های Docker را روشن نکن.

### ۲.۳. cron (فقط اگر مسیرِ B را انتخاب کردی)
```
*/10  * * * *  cd /srv/tile/web && npm run worker:expire  >> /var/log/tile-expire.log 2>&1
*/2   * * * *  cd /srv/tile/web && npm run worker:outbox  >> /var/log/tile-outbox.log 2>&1
0 */6 * * *    psql "$DATABASE_URL" -c "DELETE FROM _rate_limit_hits WHERE hit_at < now() - interval '24 hours';"
```
worker انقضا **غیرحیاتی** است (درستیِ `available` به آن وابسته نیست)؛ worker پیامک اگر نایستد، اعلان‌ها فقط عقب می‌افتند. housekeeping برای جلوگیری از رشدِ بی‌نهایتِ جدولِ rate limit.

### ۲.۴. migration قبل از اولین اجرا
اگر مسیرِ A (Docker) را انتخاب کردی، schema.sql در `docker-entrypoint-initdb.d` خودکار
اجرا می‌شود. بعد `apply.ts` را اجرا کن تا migrationهای جدید (مثل 0004) اعمال شوند:
```bash
docker compose exec web node --import tsx ../db/migrations/apply.ts
```
اگر مسیرِ B را انتخاب کردی:
```bash
psql "$DATABASE_URL" -f db/schema.sql        # فقط برای دیتابیسِ تازه
cd web && npm run migrate                     # اعمالِ migrationهای اجرا‌نشده
```

## ۳. پیامک (موردِ بازِ اصلی در کد — بقیه در بخشِ ۹)

- [ ] `src/notify/sender.ts` را برای پنل ایرانی پیاده کن (کاوه‌نگار/فراز/…). فقط همین یک تابع؛ بقیه‌ی سیستم دست نمی‌خورد.
- [ ] `SMS_PROVIDER` را ست کن. مقدار ناشناخته عمداً **fail-loud** است تا پیام اشتباهاً «ارسال‌شده» علامت نخورد.
- [ ] ردیف‌های `notification_outbox` با `status='failed'` را پایش کن (dead-letter بعد از ۵ تلاش).

## ۴. بک‌آپ و بازیابی (spec ۳.۴ و ۱۴.۱۰)

- [ ] `pg_dump` روزانه‌ی **رمزنگاری‌شده**.
- [ ] استراتژی ایران: اول روی **VPS ایرانِ دوم در دیتاسنتر متفاوت**، بعد کرونِ ساعتِ خلوت به مقصد خارجی با retry (شبکه‌ی بین‌الملل ناپایدار است).
- [ ] **تست Restore ماهانه** — بک‌آپِ تست‌نشده بک‌آپ نیست.
- [ ] RPO/RTO را مکتوب کن (MVP: بک‌آپ روزانه، نگهداری ۱۴-۳۰ روز).

## ۵. مهاجرت schema

- [ ] `db/schema.sql` فقط برای **نصب تازه** است. **هرگز روی prodِ داده‌دار دوباره اجرا نکن.**
- [ ] برای نصبِ تازه، می‌توانی `schema.sql` را اجرا کنی یا از `db/migrations/apply.ts` استفاده کنی.
- [ ] **برای تغییرِ بعد از go-live:** migrationهای forward-only در `db/migrations/`.
  ```bash
  # اجرای idempotentِ همه‌ی migrationهای اجرا‌نشده:
  node --env-file=web/.env --import tsx db/migrations/apply.ts
  ```
  این اسکریپت: migrationهای اجرا‌شده را در جدول `_migrations` ردیابی می‌کند،
  checksum فایل را برای تشخیصِ دستکاری ذخیره می‌کند، و در صورت شکستِ یک migration
  mid-way، آن migration rollback می‌شود ولی migrationهای قبلی سرجایشان می‌مانند.

## ۶. راه‌اندازی داده‌ی اولیه (bootstrap)

**(v9) دیگر SQL دستی لازم نیست.** یک حسابِ «مدیرِ پلتفرم» (`app_user.is_platform_admin = true`،
فقط با SQL/psql یک‌بار در بدوِ راه‌اندازیِ خودِ SaaS ساخته می‌شود — نه به‌ازای هر
مشتری) از صفحه‌ی `/platform/tenants` کارخانه‌ی تازه + اولین مدیرش را می‌سازد.
مدیرِ اول همان‌جا `can_manage_access=true` هم دارد، پس بلافاصله از پنلِ خودش
(`/staff/team`) بقیه‌ی تیم/نمایندگی/انبار را می‌سازد — بدونِ اینکه کسی دیگر SQL بزند.

ساختِ خودِ اولین مدیرِ پلتفرم (فقط یک‌بار، نه به‌ازای هر مشتری):
```bash
node -e "console.log(require('bcryptjs').hashSync('<رمز>',12))"
```
```sql
INSERT INTO app_user (id,phone,password_hash,is_platform_admin)
VALUES (gen_random_uuid(),'<موبایلِ اپراتورِ SaaS>','<hash>',true);
```
- [ ] نقش‌ها: `staff`/`admin` تأیید و حواله می‌زنند؛ `agent` فقط رزرو. کاربرِ نماینده **حتماً** باید به `agent_account` وصل شود وگرنه صفحه‌ی رزرو برایش کار نمی‌کند — نمایندگی‌ها هم از `/staff/team?tab=agents` ساخته می‌شوند، نه SQL.

## ۷. تصمیم‌های بازِ وابسته به مصاحبه (قبل از دادهٔ واقعی قطعی کن)

این‌ها پیش‌فرضِ تحقیق‌شده دارند ولی با کارخانه تأیید نشده‌اند (spec بخش ۷):
- [ ] **شید/کالیبر**: دیجیتال ثبت می‌شوند؟ `track_shade_caliber` (پیش‌فرض `optional`).
- [ ] **کلید طبیعیِ Lot برای import** — عمداً ایندکسِ سختی نگذاشتیم چون به جواب مصاحبه وابسته است. **قبل از اولین import واقعی قطعی کن**، وگرنه ممکن است هر روز Lot تکراری ساخته شود (spec ۱۴.۵).
- [ ] **برند**: سطح Product یا Lot.
- [ ] **snapshot یا delta**: فقط snapshot پیاده شده. اگر فایل کارخانه «فقط تغییرات» است، delta لازم می‌شود.
- [ ] **ستون‌های فایل اکسل** با قالب واقعیِ کارخانه تطبیق داده شود (`/staff/import` هدرهای fa/en را می‌شناسد).
- [ ] **سقفِ تأییدِ خودکار** (`/staff/auto-approve`) — **پیش‌فرض خاموش است و عمداً خاموش می‌ماند.** روشن‌کردنش یعنی سفارش زیرِ سقف بدونِ نگاهِ انسان قطعی می‌شود، پس باید تصمیمِ صریحِ کارخانه باشد نه پیش‌فرضِ نصب. قبل از روشن‌کردن:
  - [ ] قیمتِ **همه‌ی** کالاهای فعال ثبت شده باشد. (کالای بی‌قیمت خودکار تأیید نمی‌شود — امن است، ولی یعنی سقف روی آن کالا بی‌اثر است.)
  - [ ] نماینده‌ی تازه یا بدهکار سقفِ `۰` بگیرد (= هرگز خودکار).
  - [ ] هفته‌ی اول، `sales_request` با `approval_mode='auto'` را مرور کنید تا سقف کالیبره شود.

## ۸. پایش (سبک — spec عمداً Prometheus را رد کرده)

- [ ] لاگ سرور + لاگ دو worker.
- [ ] هفتگی چک کن: `notification_outbox` با `failed`، `import_row` با `processing_status='error'`.
- [ ] **تطبیق لجر با موجودی** (بررسی drift): `/staff/ledger` گزارش ناترازی را نشان می‌دهد.
- [ ] **فاصله‌ی cronِ انقضا و صف انتظار**: موجودیِ رزروِ منقضی از لحظه‌ی `expires_at` آزاد است، ولی صف تا اجرای بعدیِ `worker:expire` جلو نمی‌رود. یعنی پنجره‌ای به اندازه‌ی فاصله‌ی cron هست که رهگذری می‌تواند قبل از نفرِ اولِ صف موجودی را بردارد. با ۱۰–۱۵ دقیقه قابل‌قبول است؛ اگر صف شلوغ شد فاصله را کم کنید. (لغوِ رزرو این مشکل را ندارد — همان تراکنش.)

## ۹. شکاف‌های شناخته‌شده (قابل زندگی، ولی بدان)

- تبدیل backorder به موجودیِ واقعی دستی است (وقتی تولید شد، از مسیر import می‌آید و backorder دستی `fulfilled` می‌شود).
- import فقط snapshot؛ `delta` در schema هست ولی منطق ندارد.
- تصاویر محصول: روی Object Storage **داخل ایران** (آروان/چابکان) — `next/image` را به هاست خارجی وصل نکن (spec ۱۴.۱۰). فعلاً `<img>` خام است، نه `next/image`.
- ~~**CI نداریم.**~~ ✅ رفع شد — `.github/workflows/ci.yml` اضافه شد. هر push و pull request
  PostgreSQL داکری را بالا می‌آورد، migration را اجرا می‌کند، `npm test` و `npm run build` می‌زند.
- تغییر/بازیابیِ رمز و «خروج از همه‌ی دستگاه‌ها» **ساخته شده‌اند** (`auth/passwordFlows.ts`, `session_epoch`) — این دو دیگر شکاف نیستند؛ اگر جای دیگری (مثلاً یک PRDِ قدیمی) هنوز «وجود ندارد» گفته، آن سند کهنه است.

## ۹.۱. رفع‌های اخیر (حسابرسیِ فاز ۱۰–پسین)

این موارد رفع شدند (نگاه کنید به CHANGELOG برای جزئیات):

- ✅ **SECURITY DEFINER search_path** — هر چهار تابع (`user_contexts`, `expire_due_reservations`,
  `claim_pending_notifications`, `finish_notification`) حالا `SET search_path = public, pg_temp`
  دارند. این جلوی search_path injection را می‌گیرد.
- ✅ **`db/migrations/`** — ساختارِ migration با جدول `_migrations` و اسکریپتِ `apply.ts`.
  Migration اول: `0002_migrations_table.sql`، Migration دوم: `0003_rate_limit_table.sql`.
- ✅ **Orphan file cleanup** — `removeProductImage` حالا فایل فیزیکی را هم حذف می‌کند.
  اسکریپتِ `scripts/cleanup-orphan-uploads.ts` برای پاک‌کردنِ فایل‌های یتیمِ قبلی.
- ✅ **Rate limiter multi-instance** — `RATE_LIMIT_BACKEND=postgres` با جدول `_rate_limit_hits`.
  مسیرهای `login`, `password`, `reset`, `reservations`, `imports` همگی به `checkRateAsync` رفتند.
- ✅ **CI/CD** — GitHub Actions با PostgreSQL داکری، typecheck، test، build.
- ✅ **Dockerfile + docker-compose** — production-ready با multi-stage، non-root، volume آپلود،
  workerها به‌عنوان سرویس جدا.

## ۱۰. تست دود بعد از هر دیپلوی

> **خودکارش هست:** `bash scripts/prodlike-smoke.sh` کلِ این سناریو را روی یک Postgres
> یک‌بارمصرف با **نقشِ non-superuser و RLS واقعاً فعال** اجرا می‌کند (نه superuserِ dev).
> همین اسکریپت بود که باگِ «worker پیامک زیر RLS هیچ پیامی نمی‌فرستد» را پیدا کرد.

```
۱. لاگین staff و نماینده (HTTPS)
۲. /staff/import یک فایل کوچک → applied/zeroed درست
۳. نماینده: رزرو → staff: تأیید → حواله → ready_for_loading → loaded
۴. چک: on_hand دقیقاً به اندازه‌ی بارگیری کم شده
۵. /staff/ledger: ناترازی صفر باشد
```
