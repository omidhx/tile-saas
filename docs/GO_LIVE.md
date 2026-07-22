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
  AUTH_SECRET=<openssl rand -base64 32>
  SMS_PROVIDER=<ارائه‌دهنده>            # پیش‌فرض log = فقط چاپ می‌کند
  ```
- [ ] **HTTPS اجباری.** کوکی نشست در production `Secure` است؛ **روی HTTP لاگین اصلاً کار نمی‌کند.** Caddy/Nginx + Let's Encrypt.
- [ ] **کاربر و کارخانه‌ی اولیه.** هیچ فرم ثبت‌نامی وجود ندارد (عمدی — B2B). اولین tenant/کاربر با SQL ساخته می‌شود: بخش ۶ پایین.

---

## ۱. Reverse proxy (Caddy/Nginx)

- [ ] TLS با Let's Encrypt.
- [ ] **`X-Forwarded-For` را ست کن** — rate limiting IP کلاینت را از همین هدر می‌خواند؛ بدون آن همه‌ی کاربران در یک سطل می‌افتند و یک نفر می‌تواند بقیه را قفل کند.
- [ ] **HSTS در پروکسی** ست شود (عمداً در اپ نگذاشتیم تا dev روی HTTP نشکند).
- [ ] پورت Postgres **هرگز** به اینترنت expose نشود (spec ۳.۴).

## ۲. اجرای اپ

- [ ] `npm ci && npm run build && npm run start` پشت PM2/systemd.
- [ ] ⚠️ **عکس‌های کاتالوگ در `web/public/uploads/` روی دیسک ذخیره می‌شوند** (کاتالوگ تصویری). این پوشه باید روی یک **volume جدا از کدِ دیپلوی‌شونده** باشد (symlink یا bind-mount)، وگرنه هر `npm run build`/دیپلوی عکس‌ها را پاک می‌کند. در git هم ignore شده. اگر عکس‌ها فقط با URLِ خارجی می‌آیند (ستونِ عکسِ اکسل)، این مورد بی‌اثر است.
- [ ] ⚠️ **rate limiter در حافظه‌ی همان پروسه است.** با PM2 cluster یا چند instance، سقف در تعداد پروسه‌ها ضرب می‌شود. یا **تک-instance** اجرا کن، یا limiter را به Postgres/Redis منتقل کن (`src/auth/rateLimit.ts`، upgrade path داخلش نوشته شده).
- [ ] دو cron:
  ```
  */10 * * * *  cd /srv/tile/web && npm run worker:expire  >> /var/log/tile-expire.log 2>&1
  */2  * * * *  cd /srv/tile/web && npm run worker:outbox  >> /var/log/tile-outbox.log 2>&1
  ```
  worker انقضا **غیرحیاتی** است (درستیِ `available` به آن وابسته نیست)؛ worker پیامک اگر نایستد، اعلان‌ها فقط عقب می‌افتند.

## ۳. پیامک (تنها موردِ باز در کد)

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
- [ ] از اولین تغییرِ بعد از go-live: migrationهای forward نسخه‌دار در `db/migrations/`.

## ۶. راه‌اندازی داده‌ی اولیه (bootstrap)

بدون فرم ثبت‌نام، اولین کارخانه و کاربران با SQL ساخته می‌شوند. هش رمز:
```bash
node -e "console.log(require('bcryptjs').hashSync('<رمز>',12))"
```
```sql
INSERT INTO tenant (id,name,slug) VALUES (gen_random_uuid(),'<نام کارخانه>','<slug>');
-- کاربر پشتیبان (staff) و نماینده:
INSERT INTO app_user (id,phone,password_hash) VALUES (gen_random_uuid(),'<موبایل>','<hash>');
INSERT INTO tenant_membership (tenant_id,user_id,role,is_active) VALUES (<tenant>,<user>,'staff',true);
-- نماینده علاوه بر membership به یک agent_account هم وصل می‌شود:
INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES (gen_random_uuid(),<tenant>,'<نمایندگی>','AG1');
INSERT INTO agent_account_user (tenant_id,agent_account_id,user_id,role) VALUES (<tenant>,<agent>,<user>,'operator');
-- انبار و کاتالوگ پایه، بعد موجودی از اکسل (/staff/import)
```
- [ ] نقش‌ها: `staff`/`admin` تأیید و حواله می‌زنند؛ `agent` فقط رزرو. کاربرِ نماینده **حتماً** باید به `agent_account` وصل شود وگرنه صفحه‌ی رزرو برایش کار نمی‌کند.

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

- تغییر/بازیابی رمز عبور وجود ندارد → فعلاً staff دستی ریست می‌کند.
- «خروج از همه‌ی دستگاه‌ها» نیاز به نسخه‌گذاریِ توکن دارد (JWT بی‌حالت است).
- سوییچرِ چند-نمایندگی نیست؛ اولین context انتخاب می‌شود.
- تبدیل backorder به موجودیِ واقعی دستی است (وقتی تولید شد، از مسیر import می‌آید و backorder دستی `fulfilled` می‌شود).
- import فقط snapshot؛ `delta` در schema هست ولی منطق ندارد.
- تصاویر محصول: روی Object Storage **داخل ایران** (آروان/چابکان) — `next/image` را به هاست خارجی وصل نکن (spec ۱۴.۱۰).

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
