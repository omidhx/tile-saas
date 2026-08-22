# MEMORY — حافظه‌ی پروژه‌ی tile-saas

> **این فایل حافظه‌ی کاریِ من برای پروژه‌ی `tile-saas` است.** هر کار مهمی که انجام می‌دهم
> را اینجا ثبت می‌کنم تا در جلسات بعدی بدانم چه کرده‌ام و کجا ایستاده‌ام. الگوی
> «قرار گرفتن در ذهنِ تازه» — هر کسی (حتی خودِ من در یک جلسه‌ی تازه) با خواندنِ این
> فایل باید بداند پروژه در چه وضعیتی است و چه کارهای اخیر انجام شده‌اند.
>
> **تاریخ شروع:** 2026-08-22
> **وضعیت کلی:** آماده‌ی آنلاین‌شدن (پس از رفعِ ایراداتِ فاز ۱۰)

---

## 🎯 اطلاعات کلیدی پروژه

| مورد | مقدار |
|---|---|
| **نام** | tile-saas |
| **نوع** | Vertical SaaS چندمستأجرنی (Multi-Tenant) برای صنعت کاشی/سرامیک ایران |
| **Stack** | Next.js 16 (App Router, TS) + PostgreSQL 16 + Drizzle (introspect) |
| **میزبانی هدف** | VPS ایران (Docker/PM2 + Nginx/Caddy) |
| **ریپازیتوری** | https://github.com/omidhx/tile-saas (خصوصی) |
| **مسیر محلی** | `/home/z/my-project/tile-saas/` |
| **منبع حقیقت** | `db/schema.sql` (نه ORM) + `tile-saas-comprehensive-spec.md` |

---

## 📜 تاریخچه‌ی کارها (برای عقب‌نگری)

### ۲۰۲۶-۰۸-۲۲ — جلسه‌ی اول

#### فاز ۱: بررسی کامل پروژه
- **کار:** کلون کردم و فولدر به فولدر، فایل به فایل، خط به خط کد را بررسی کردم.
- **خروجی:** گزارش جامع تحلیل به کاربر ارائه شد — معماری، نقش‌ها، مسیرها، امنیت،
  آمار کلی، مسدودکننده‌های go-live.
- **یادداشت‌های کلیدی:**
  - ۸ قانون معماری غیرقابل‌نقض به‌درستی در کد پیاده شده.
  - ۴۴ API endpoint، ۲۶+ ماژول db، ~۲۵ صفحه‌ی App Router، ۲۷۴ تستِ سبز.
  - مسدودکننده‌های go-live: نقش non-superuser، HTTPS، Provider پیامک واقعی،
    Volume برای آپلودها، ۲ cron.

#### فاز ۲: بازبینیِ تحلیلِ یک مدل AI دیگر
- **کار:** تحلیل هوش مصنوعی دیگر را کد-level بررسی کردم.
- **نتیجه:** ۶ ایراد واقعی تأیید شد، ۲ ایراد رد شد:
  - ✅ تأیید شد: SECURITY DEFINER بدون search_path، نبودِ migrations،
    نبودِ orphan cleanup، rate limiter درون حافظه‌ای، نبودِ CI/CD، نبودِ Dockerfile.
  - ❌ رد شد: نیاز به TanStack Query (over-engineering)، نیاز به CSRF token
    (SameSite=lax کافی است).

#### فاز ۳: رفعِ ایرادات (۱۴ فایل تغییر/ایجاد)
- ✅ **SECURITY DEFINER search_path** — هر ۴ تابع PostgreSQL
  (`user_contexts`, `expire_due_reservations`, `claim_pending_notifications`,
  `finish_notification`) حالا `SET search_path = public, pg_temp` دارند.
- ✅ **`db/migrations/`** ساختار:
  - `0002_migrations_table.sql` — جدول `_migrations` با checksum
  - `0003_rate_limit_table.sql` — جدول `_rate_limit_hits` برای multi-instance
  - `apply.ts` — اسکریپت idempotent با checksum validation
  - `README.md` — راهنما
- ✅ **Orphan file cleanup:**
  - `web/src/lib/fileCleanup.ts` — ابزار `deleteUploadFile`
  - `web/src/db/products.ts` — `removeProductImage` حالا فایل فیزیکی را هم حذف می‌کند
  - `web/scripts/cleanup-orphan-uploads.ts` — با dry-run
- ✅ **Rate limiter دو-حالته:**
  - `web/src/auth/rateLimit.ts` — `RATE_LIMIT_BACKEND=memory|postgres`
  - ۵ مسیر به `checkRateAsync` رفتند: login, password, reset, reservations, imports
- ✅ **CI/CD:** `.github/workflows/ci.yml` با PostgreSQL داکری
- ✅ **Dockerfile + docker-compose** — multi-stage، non-root، workerها به‌عنوان سرویس
- ✅ **`.env.example`** در ریشه
- ✅ **`.dockerignore`**
- ✅ **`web/package.json`** — اسکریپت‌های `npm run migrate` و `npm run cleanup:uploads`
- ✅ **رفعِ bug در `.gitignore`** — `.env.example` به‌اشتباه ignore می‌شد
- ✅ **`docs/GO_LIVE.md`** — چک‌لیست به‌روز با بخش ۹.۱
- ✅ **`CHANGELOG.md`** — ورودیِ فاز ۱۰-پسین

#### فاز ۴: مستندسازی
- ✅ **این فایل (`MEMORY.md`)** ساخته شد.
- ✅ **`/home/z/my-project/worklog.md`** به‌روز شد با خلاصه‌ی کارهای جلسه.
- ✅ **به‌روزرسانیِ همه‌ی فایل‌های `docs/`** با تغییراتِ فاز ۱۰.

#### فاز ۵: بازبینیِ دورِ دوم (مدل AI دیگر)
- کاربر یک تحلیلِ دقیق‌تر از همان مدل AI دیگر آورد که نقص‌های فاز ۳ را هم دید.
- **پذیرشِ شفاف:** حق با او بود. جشن زود بود — Postgres محلی نداشتم، تست واقعی migration نزدم، CI هرگز سبز نشد.
- **رفع‌های این دور:**
  1. ✅ migration `0004_lock_definer_search_path.sql` با `CREATE OR REPLACE FUNCTION` + assertion — حالا دیتابیسِ موجود هم فیکس می‌شود، نه فقط نصبِ تازه.
  2. ✅ GRANT صریح به `app_user` داخلِ migrationهای 0002 و 0003 (با `DO $$` برایِ بررسیِ وجودِ نقش) — قبلاً `GRANT ... ON ALL TABLES` فقط جدول‌های همان لحظه را می‌گرفت.
  3. ✅ **Rate limiter fail policy هوشمند:** برای auth مسیرها fail-closed (اگر DB پایین باشد، fallback به in-memory + Sentry error). برای بقیه fail-open.
  4. ✅ **CSRF سبک** (`assertSameOrigin`) — چکِ Origin/Host روی state-changing endpoints. درِ اضافی، حدود ۱۰ خط، ولی subdomain و WebView را هم می‌پوشاند.
  5. ✅ **`deleteUploadFile` اعتبارسنجیِ path traversal** — اگر کسی در DB مسیر `/uploads/../../.env` گذاشته باشد، رد می‌کند و با Sentry لاگ می‌کند.
  6. ✅ **همگام‌سازیِ `schema.sql` و migrations** — `_migrations` و `_rate_limit_hits` حالا در `schema.sql` هم هستند. دو منبع حقیقت نیست.
  7. ✅ **`/api/health` endpoint** — بررسیِ واقعیِ DB با `SELECT 1`. برای Docker healthcheck و reverse proxy.
  8. ✅ **تست‌های regression** برای فیکس‌ها:
     - `securityDefiner.test.ts` — اعتبارسنجیِ search_path روی هر چهار تابع + سناریوی migration 0004.
     - `rateLimitPostgres.test.ts` — تستِ موازی، isolation، و sliding window.
     - `fileCleanup.test.ts` — تستِ path traversal، فایلِ غیرموجود، فایل موجود، batch delete.
  9. ✅ **worker housekeeping** در docker-compose — هر ۶ ساعت، ردیف‌های قدیمیِ `_rate_limit_hits` را پاک می‌کند.
  10. ✅ **`GO_LIVE.md` با دو مسیرِ دیپلوی** — Docker (توصیه‌شده) یا نصبِ مستقیم + cron. تک‌منبعِ زمان‌بندی. هر دو را هم‌زمان اجرا نکنید.
  11. ✅ **CHANGELOG با وضعیتِ «اضافه شد، اجرا نشده»** — صادقانه، نه «رفع شد».

#### پاسخ به ۳ سؤال معماری از دورِ قبلی که نداده بودم:

۱. **قفل `ORDER BY lot_id FOR UPDATE`** — در کد هست (`reservations.ts`، `salesRequests.ts`، `dispatches.ts`، `imports.ts`). این الگوی ثابتِ پروژه است و جلوی deadlock را می‌گیرد وقتی دو تراکنشِ هم‌زمان چند lot مشترک را قفل می‌کنند. بدونِ ترتیبِ ثابت، deadlock در multi-item حتمی است.

۲. **سقف login روی instance دوم** — در حالتِ `RATE_LIMIT_BACKEND=memory` سقف در تعداد پروسه‌ها ضرب می‌شد. حالا با `postgres` backend، سقفِ واقعاً global است. ولی اگر کسی `memory` را در multi-instance فعال کند، باگ برگشته. **راه‌حل:** در `docker-compose.yml` پیش‌فرض `RATE_LIMIT_BACKEND=postgres` گذاشتیم.

۳. **ممنوعیتِ ستون `held`** — در `schema.sql` به‌صورتِ VIEW محاسباتی پیاده شده، نه ستون. این قانون معماری #۱ است. هیچ `held_qty_boxes` در هیچ جدولی وجود ندارد — همیشه `SUM(reservation_item WHERE active AND expires_at > now())`.

## 🗂️ نقشه‌ی فایل‌های مهم

### مسیرهای بحرانی (هرگز بدونِ توجه تغییر نده)
- `db/schema.sql` — منبع حقیقتِ دیتابیس (۹۴۰+ خط)
- `db/migrations/apply.ts` — اسکریپتِ migration
- `web/src/db/reservations.ts` — قلبِ الگوریتمِ رزرو
- `web/src/auth/authz.ts` — chokepointهای authorization
- `web/src/auth/session.ts` — JWT و session_epoch
- `web/src/middleware.ts` — CSP nonce per-request
- `tile-saas-comprehensive-spec.md` — مرجعِ کاملِ معماری

### فایل‌هایی که ساختم/تغییر دادم
| فایل | نوع تغییر |
|---|---|
| `db/schema.sql` | تغییر — ۴ تابع SECURITY DEFINER |
| `db/migrations/0002_migrations_table.sql` | جدید |
| `db/migrations/0003_rate_limit_table.sql` | جدید |
| `db/migrations/apply.ts` | جدید |
| `db/migrations/README.md` | جدید |
| `web/src/auth/rateLimit.ts` | تغییر — backend دو-حالته |
| `web/src/lib/fileCleanup.ts` | جدید |
| `web/src/db/products.ts` | تغییر — removeProductImage |
| `web/scripts/cleanup-orphan-uploads.ts` | جدید |
| `web/src/app/api/auth/login/route.ts` | تغییر — checkRateAsync |
| `web/src/app/api/auth/password/route.ts` | تغییر — checkRateAsync |
| `web/src/app/api/auth/reset/route.ts` | تغییر — checkRateAsync |
| `web/src/app/api/imports/route.ts` | تغییر — checkRateAsync |
| `web/src/app/api/reservations/route.ts` | تغییر — checkRateAsync |
| `Dockerfile` | جدید |
| `docker-compose.yml` | جدید |
| `.dockerignore` | جدید |
| `.env.example` | جدید |
| `.github/workflows/ci.yml` | جدید |
| `.gitignore` | تغییر — `!.env.example` |
| `web/.gitignore` | تغییر — `!.env.example` |
| `web/package.json` | تغییر — اسکریپت‌های تازه |
| `docs/GO_LIVE.md` | تغییر — چک‌لیست نهایی |
| `CHANGELOG.md` | تغییر — ورودیِ فاز ۱۰ |

---

#### فاز ۶: پاسخ به تمرینِ بازبین + اثباتِ واقعی

بازبینِ دورِ سوم سه سؤال تمرینی پرسید و گفت: «اگر این سه را با ارجاع فایل جواب بدی، این فاز را می‌بندیم.»

**پاسخ ۳ سؤال (با ارجاع فایل):**

۱. **migration 0004 کجاست؟**
   - فایل: `db/migrations/0004_lock_definer_search_path.sql`
   - شماره: 0004 (بعد از 0003)
   - ۱۰۶ خط، شامل ۴ `CREATE OR REPLACE FUNCTION` + assertion با `DO $$`

۲. **در rateLimit.ts وقتی Postgres پایین است، برای login چه می‌شود؟**
   - فایل: `web/src/auth/rateLimit.ts`، خط ۱۲۶-۱۴۶
   - جواب: **fallback به in-memory** (نه return false)
   - `failPolicy === "closed"` → `checkRateMemory(key, limit, windowMs, now)` + Sentry با سطح `error`
   - رفرنس مسیر login: `web/src/app/api/auth/login/route.ts` خط ۲۷-۳۶ — `failPolicy: "closed"`

۳. **docker-compose کدام worker housekeeping را دارد؟**
   - فایل: `docker-compose.yml`، خط ۱۱۹-۱۴۷
   - جواب: **سرویس سوم جدا** به نام `worker-housekeeping` (نه در expire و نه در outbox)
   - هر ۶ ساعت، `DELETE FROM _rate_limit_hits WHERE hit_at < now() - interval '24 hours'`

**رفع‌های این دور (فاز ۶):**

۱. ✅ **سیاست mismatch در apply.ts** — خط ۹۵-۱۳۷ در `db/migrations/apply.ts`. دو نسخه از سیاست:
   - VERSION 1: checksum mismatch در migration اجرا‌شده → `exit(1)` (fail-loud)
   - VERSION 2: schema.sql vs migrations — هر تغییری در schema باید در هر دو جا انجام شود (دستی، ولی در comment توضیح داده شده)

۲. ✅ **تست drift بین schema.sql و migrations** — فایل: `web/src/db/schemaMigrationsDrift.test.ts`. با `pg_dump --schema-only` دو دیتابیس (فقط schema.sql و schema.sql + migrations) را مقایسه می‌کند. اگر اختلافی باشد، fail می‌کند. (نیاز به `pg_dump` در CI)

۳. ✅ **تست واقعی migration 0004 روی PGlite** — فایل: `web/scripts/test-migration-0004.ts`. این اولین اثباتِ واقعی است:
   - PGlite (PostgreSQL در WASM) را بالا می‌آورد
   - جداولِ پایه + توابعِ قدیمی (بدون search_path) را می‌سازد
   - migration 0004 را اجرا می‌کند
   - چک می‌کند که هر چهار تابع حالا `SET search_path = public, pg_temp` دارند
   - نتیجه: **موفقیت** ✓ (اجرای واقعی، نه فقط syntax check)
   - دستور: `cd web && npm run test:migration`

۴. ✅ **assertion در migration 0004 با LIKE به‌جای @>** — خط ۱۰۸-۱۱۴ در `0004`. فرمتِ proconfig در PGlite متفاوت بود (`{search_path=public, pg_temp}` به‌جای `['search_path=public, pg_temp']`). با `proconfig::text LIKE '%search_path=public, pg_temp%'` هر دو حالت پوشش داده شد. این یک باگ واقعی بود که فقط با اجرای واقعی کشف شد.

۵. ✅ **تست securityDefiner.test.ts با منطق LIKE** — هماهنگ با assertion.

۶. ✅ **RUNBOOK_MIGRATION.md** — فایل: `docs/RUNBOOK_MIGRATION.md`. راهنمای کاملِ اعمالِ migration روی production: پیش‌نیازها، اجرا، اعتبارسنجی، عیب‌یابی، rollback، چک‌لیست.

**چه چیزی هنوز «اضافه شد، اجرا نشده»:**

- **CI روی GitHub**: YAML نوشته شده ولی اولین push هنوز سبز نشده. این نیاز به کاربر دارد — push کند تا CI سبز شود.
- **migration 0004 روی production**: تستِ واقعی روی PGlite انجام شد (سبز)، ولی روی VPS production هنوز اجرا نشده. RUNBOOK_MIGRATION.md راهنمای کامل را دارد.

**نکته‌ی کلیدی:** با PGlite، توانستیم migration 0004 را روی یک دیتابیسِ واقعی (نه فقط syntax check) تست کنیم و سبز شد. این از «کاغذی» به «اثبات‌شده روی PGlite» ارتقا یافت. ولی PGlite ≠ PostgreSQL 16 کامل — تفاوت‌های لبه‌ای ممکن است در production ظاهر شوند. برای اطمینانِ کامل، اجرای واقعی روی PostgreSQL 16 در CI لازم است.


## 🚦 وضعیت go-live (آخرین به‌روزرسانی: ۲۰۲۶-۰۸-۲۲)

### ✅ رفع‌شده‌ها
- [x] SECURITY DEFINER search_path
- [x] ساختارِ migration
- [x] Orphan file cleanup
- [x] Rate limiter multi-instance (با backend قابل انتخاب)
- [x] CI/CD با GitHub Actions
- [x] Dockerfile + docker-compose

### ⏳ موارد عملیاتی (کاربر باید روی سرور انجام دهد)
- [ ] ساختِ نقشِ `app_user` non-superuser در PostgreSQL
- [ ] تنظیمِ `AUTH_SECRET` واقعی (≥۳۲ کاراکتر)
- [ ] HTTPS با Let's Encrypt روی Caddy/Nginx
- [ ] Provider پیامک واقعی (kavenegar/ippanel/melipayamak/sms.ir/farazsms)
- [ ] Volume جدا برای `web/public/uploads/`
- [ ] ۲ cron: `worker:expire` (هر ۱۰ دقیقه)، `worker:outbox` (هر ۲ دقیقه)

### ⏳ موارد وابسته به مصاحبه با کارخانه
- [ ] شید/کالیبر: دیجیتال ثبت می‌شوند؟ (`track_shade_caliber`)
- [ ] کلید طبیعی Lot برای import
- [ ] snapshot یا delta برای فایل اکسل
- [ ] برند: سطح Product یا Lot
- [ ] سقفِ تأیید خودکار (پیش‌فرض خاموش)

---

## 🧠 تصمیماتِ طراحیِ مهم (که نباید فراموش کنم)

1. **`schema.sql` منبع حقیقت است** — نه ORM. Drizzle فقط introspect می‌کند.
   هر تغییر در schema باید در `schema.sql` و یک migration در `db/migrations/` باشد.

2. **`held` هرگز ستون ذخیره‌شده نیست نیست** — همیشه `SUM(reservation_item WHERE
   active AND expires_at > now())`. این قانون معماری #۱ است.

3. **`available = on_hand − held − allocated − blocked`** — همیشه.

4. **هر تراکنشِ موجودی باید ردیفِ `inventory_balance` را `FOR UPDATE` با
   `ORDER BY lot_id` قفل کند** — جلوی deadlock.

5. **Authorization > Authentication** — هر route باید chokepoint داشته باشد.
   tenant/agent هرگز از body باور نمی‌شود.

6. **پول و متراژ همیشه عدد صحیح‌اند** — اعشار فقط در لایه‌ی UI.

7. **Ponytail (کمترین کدِ درست) > over-engineering** — Redis، React Query،
   Tailwind همگی رد شده‌اند چون مقیاسِ پروژه چند ده نماینده است.

8. **هرگز از Vercel/Supabase استفاده نکن** — تحریم OFAC. VPS ایران.

9. **فونت از `next/font/google` استفاده نکن** — روی VPS ایران می‌شکند.
   Vazirmatn self-hosted از `@fontsource-variable/vazirmatn`.

10. **`SECURITY DEFINER` همیشه `SET search_path = public, pg_temp` داشته باشد**
    — جلوی search_path injection.

---

## 📋 قدم‌های بعدی (Next Actions)

1. **تکمیل‌شده:** رفعِ نقص‌های دورِ دوم + تست‌های regression + مستندسازی صادقانه.
2. **بعد:** اولین push روی GitHub — اگر CI سبز شد، «رفع شد» را جای «اضافه شد» می‌گذاریم.
3. **سپس:** کمک به کاربر برای آنلاین‌کردنِ پروژه روی VPS ایران.

---

## 📞 یادداشت‌های ارتباط با کاربر

- کاربر می‌خواهد «فولدر به فولدر، فایل به فایل، خط به خط» کد بررسی شود.
- کاربر می‌خواهد قبل از آنلاین‌شدن، ایرادات رفع شوند.
- کاربر خواست که مموری شخصی برای خودم بسازم.
- توکنِ PAT برای دسترسی به ریپازیتوری خصوصی در اختیارم بود (نباید لو برود).
- کاربر فارسی‌زبان است — تمامِ تعاملات به فارسی.

---

_این فایل زنده است. هر بار که کاری در پروژه انجام دادم، اینجا به‌روزرسانی می‌کنم._
