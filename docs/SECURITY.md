# SECURITY — تهدیدمدل و دفاع‌ها

> این سند **تهدیدمدل** است، نه چک‌لیست دیپلوی. کارهای اجرایی (نقش‌های DB، HTTPS،
> بک‌آپ، cron) در [GO_LIVE.md](GO_LIVE.md) است؛ استدلال معماری در spec بخش ۸.
>
> هر دفاعی که اینجا ادعا شده، جای پیاده‌سازی‌اش ذکر شده. ادعای بدون مرجع ننوشتم.

---

## ۱. چه چیزی را از چه کسی محافظت می‌کنیم؟

**دارایی‌ها، به ترتیب اهمیت:**
1. **موجودی و تعهدات** (`inventory_balance`, `reservation`, `sales_request`) — اگر خراب شود، کارخانه جنسی را دوبار می‌فروشد یا فروش را از دست می‌دهد. مستقیماً پول.
2. **جداییِ داده‌ی کارخانه‌ها** — کارخانه A نباید موجودی، قیمت یا مشتریِ B را ببیند. اگر نشت کند، محصول از نظر تجاری مرده است.
3. **جداییِ نمایندگان درون یک کارخانه** — نماینده‌ی X نباید رزرو/قیمتِ Y را ببیند.
4. **قیمت‌های اختصاصی** (`agent_price_override`) — نماینده‌ها نباید قیمت هم را ببینند (spec ۵.۷).
5. **اعتبار ورود** — نه کارت بانکی داریم نه پرداخت، پس ارزشِ مهاجم عمدتاً «دیدنِ داده‌ی رقیب» است.

**مهاجمانی که جدی می‌گیریم:**
| مهاجم | انگیزه | واقع‌بینانه؟ |
|---|---|---|
| **نماینده‌ی کنجکاو/رقیب** (کاربر معتبر) | دیدن موجودی/قیمتِ نمایندگی یا کارخانه‌ی دیگر | **بله — تهدید اصلی** |
| اسکنر خودکار اینترنت | brute-force ورود، تزریق | بله (هر IP عمومی) |
| کارمند سابقِ نمایندگی | نشستِ باطل‌نشده | بله |
| مهاجم با دسترسی به شبکه‌ی داخلی دیتاسنتر | دیتابیس | کم، ولی ممکن |

**خارج از دامنه (صریحاً):** مهاجم با دسترسی root روی VPS (بازیِ تمام‌شده)، DDoS در حد شبکه (کارِ ارائه‌دهنده)، حمله‌ی زنجیره‌ی تأمینِ npm (با lockfile کاهش داده شده، حذف نشده)، و امنیت فیزیکیِ انبار.

---

## ۲. تهدید شماره‌یک: IDOR و نشت بین‌تننتی

spec بخش ۸ درست تشخیص داده: **خطر واقعیِ این اپ SQL Injection نیست، IDOR است.** کاربر معتبر است؛ فقط `id` را عوض می‌کند.

**دفاع چندلایه (هر لایه مستقل کار می‌کند):**

| لایه | جا | اگر تنها همین بود چه می‌شد؟ |
|---|---|---|
| ۱. chokepoint دسترسی | `auth/authz.ts` — `authorizeAgent` عضویت و اتصالِ کاربر↔نمایندگی را در برابر DB تأیید می‌کند | باگ در یک route → دور زدنی |
| ۲. فیلترِ صریحِ `tenant_id` در کوئری | همه‌ی مسیرهای موجودی | اگر RLS خاموش شود، این هنوز کار می‌کند |
| ۳. RLS با `FORCE` | `db/schema.sql` روی **هر** جدولِ دارای `tenant_id` | اگر کد فیلتر را جا بیندازد، DB جلویش را می‌گیرد |
| ۴. composite FK `(tenant_id, x_id)` | همه‌ی روابط | ارجاعِ بین‌تننتی از نظر ساختاری غیرممکن |

**چرا چهار لایه و نه یکی:** RLS به یک متغیر session (`app.tenant_id`) وابسته است؛ یک مسیر کد که آن را ست نکند، RLS را بی‌اثر می‌کند. composite FK یک قیدِ سختِ دیتابیسی است که مستقل از هر باگ کدی کار می‌کند. spec صراحتاً می‌گوید «با هم لازم‌اند، نه یکی به‌جای اون یکی».

**تست‌شده:** `auth/authz.test.ts` (IDOR بین‌تننتی و درون‌تننتی)، `db/test_schema.sql` تست ۴ (ایزوله‌ی RLS با نقشِ non-superuser واقعی)، `cancelReservation.test.ts` (نماینده نمی‌تواند رزروِ نمایندگی دیگر را لغو کند — و `not_found` می‌گیرد نه `not_active`، تا وجود idها را هم لو ندهد).

**⚠️ شرطِ حیاتی که در عمل شکست:** RLS فقط وقتی کار می‌کند که اپ با نقشی وصل شود که **نه superuser است نه مالکِ جدول‌ها** — هر دو RLS را دور می‌زنند. در dev ما با superuser وصل می‌شویم، یعنی RLS آنجا عملاً خاموش است. این تفاوت یک باگ واقعی را پنهان کرده بود (بخش ۶ پایین). `scripts/prodlike-smoke.sh` اپ را با نقشِ محدود اجرا می‌کند؛ **قبل از هر دیپلوی اجرایش کن.**

---

## ۳. یکپارچگیِ موجودی (تهدیدی که مهاجم لازم ندارد)

بزرگ‌ترین خطرِ «پول» اینجا سوءنیت نیست، **همزمانی** است.

| تهدید | دفاع | جا |
|---|---|---|
| فروش دوبل (دو رزروِ هم‌زمان روی یک Lot) | قفل ردیفِ `inventory_balance` با `FOR UPDATE` در تراکنش کوتاه | `db/reservations.ts` |
| Deadlock بین مسیرهای هم‌زمان | **همه‌ی** قفل‌ها با `ORDER BY lot_id` | رزرو/تأیید/بارگیری/import |
| موجودی منفی | `CHECK (allocated+blocked <= on_hand)` + چکِ `available >= requested` | schema + `reserve()` |
| رزروِ نصفه | all-or-nothing در یک تراکنش | `reserve()` |
| کم‌شدنِ دوباره‌ی موجودی (retry بارگیری) | گذارِ state-guarded: فقط از `ready_for_loading` | `dispatches.ts` |
| تأییدِ دوباره‌ی یک رزرو | `UPDATE ... WHERE status='active' RETURNING` | `salesRequests.ts` |
| ارسال دوباره‌ی پیامک | claim اتمیک با `SKIP LOCKED` | `outbox.ts` |
| کلیدِ idempotency تکراری با payload متفاوت | هشِ payload → `409` به‌جای برگرداندنِ رزروِ اشتباه | `reserve()` |
| **تغییرِ موجودی از مسیرِ ثبت‌نشده** | لجر append-only + گزارشِ ناترازی | `/staff/ledger` |

آخری مهم است: هر تغییرِ موجودی یک ردیف لجر می‌نویسد، و `findDrift()` چک می‌کند که `SUM(deltaها) == موجودی`. هر اختلافی یعنی کسی از بیرونِ اپ به دیتابیس دست زده. تست `ledger.test.ts` اثبات می‌کند کلِ زنجیره ناترازیِ **صفر** می‌دهد.

---

## ۴. احراز هویت و نشست

| موضوع | تصمیم | جا |
|---|---|---|
| ذخیره‌ی رمز | **bcrypt cost 12** — نه الگوریتم دست‌ساز | `auth/password.ts` |
| نشست | JWT امضاشده با `jose` در کوکی `HttpOnly` + `SameSite=lax` + `Secure` (در production) | `auth/session.ts` |
| کلیدِ امضا | `AUTH_SECRET` باید حداقل ۳۲ کاراکتر باشد؛ نبودش **fail-loud** است (throw)، نه fail-open — قبلاً نبودش بی‌صدا کلیدِ خالی می‌ساخت و هر توکنی قابلِ جعل می‌شد | `auth/session.ts` |
| افشای وجود کاربر | پیامِ یکسان برای هر شکست؛ verify روی هشِ الکی در لاگین و در `requestReset`/`confirmReset` (هر دو مسیر شکلِ رفت‌وبرگشتِ DB را هم یکسان نگه می‌دارند، نه فقط پاسخ را — ضدِ تحلیلِ زمان‌بندی) | `api/auth/login`, `auth/passwordFlows.ts` |
| تغییر/بازیابیِ رمز | کدِ پیامکیِ یک‌بارمصرف (هش‌شده، ۱۰دقیقه، سقفِ ۵ تلاش)؛ هر تغییرِ رمز همه‌ی نشست‌ها را در همان تراکنش باطل می‌کند (`session_epoch`) | `auth/passwordFlows.ts`, `api/account/password`, `api/auth/reset` |
| خروج | `POST` نه `GET` — با `<img>` سایتِ دیگر نمی‌شود کاربر را خارج کرد؛ «خروج از همه‌ی دستگاه‌ها» هم هست (`logout-all`) | `api/auth/logout`, `api/auth/logout-all` |
| brute-force | rate limit **دولایه**: هر IP ۲۰/۱۵دقیقه و هر شماره ۵/۱۵دقیقه | `auth/rateLimit.ts` |

**چرا دولایه:** فقط per-IP جلوی brute-force روی یک حساب از IPهای چرخان را نمی‌گیرد؛ فقط per-phone جلوی اسپری روی کاربران مختلف را نمی‌گیرد.

**نقاط ضعفِ پذیرفته‌شده (هنوز واقعی):**
- ~~**rate limiter در حافظه‌ی پروسه است.** با چند instance سقف ضرب می‌شود و با ری‌استارت صفر. spec عمداً Redis را در این مقیاس رد کرده. → اگر multi-instance شدی، به Postgres منتقلش کن. (سرریزِ نقشه دیگر همه‌ی شمارنده‌ها را یک‌جا پاک نمی‌کند — فقط کلیدهای واقعاً راکد را هرس می‌کند.)~~ ✅ رفع شد (Phase 10-post): `RATE_LIMIT_BACKEND=postgres` حالا از جدول `_rate_limit_hits` استفاده می‌کند. در `memory` همچنان تک-instance است (سقف ضرب می‌شود ولی برای تک-instance کافی).
- **2FA/OTP برای ورودِ روزمره نداریم** (کدِ پیامکی فقط برای بازیابیِ رمز است).
- **fail-open در Postgres backend:** اگر DB در دسترس نباشد، rate limiter در حالتِ `postgres` درخواست را رد نمی‌کند (در دسترس بودن > rate limit). این یک تصمیم آگاهانه است، نه باگ.

---

## ۵. سطوحِ ورودی و تزریق

- **SQL Injection:** همه‌ی کوئری‌ها parameterized (postgres.js تگ‌ددتمپلیت). هیچ رشته‌ای با concatenation ساخته نمی‌شود. تنها `sql.unsafe` در `_testdb.ts` است که فقط در تست و روی متنِ ثابتِ خودمان اجرا می‌شود.
- **XSS:** React به‌صورت پیش‌فرض escape می‌کند و هیچ‌جا `dangerouslySetInnerHTML` نداریم.
- **آپلودِ اکسل:** هیچ فایلی به سرور نمی‌رسد. اکسل در **مرورگر** با SheetJS پارس می‌شود و فقط JSON ارسال می‌گردد — سقفِ ۵۰۰۰ ردیف روی JSON اعمال می‌شود، و قبل از parse سقفِ حجمِ فایل (۱۰MB) هم هست. `xlsx` روی `0.20.3` پین است، نصب‌شده مستقیم از CDNِ خودِ SheetJS (`https://cdn.sheetjs.com/...`) نه npm — چون SheetJS دیگر نسخه‌های فیکس‌شده را در npm registry منتشر نمی‌کند؛ آسیب‌پذیریِ prototype-pollution/ReDoSِ قبلی با این نسخه رفع شده (`package-lock.json` هشِ tarball را پین کرده، پس نصب تکرارپذیر می‌ماند).
- **آپلودِ عکسِ محصول:** فایل واقعاً به سرور می‌رسد (`api/upload`، staff-only). نامِ فایل همیشه `randomUUID()` است (بدونِ ریسکِ path traversal)؛ نوعِ فایل هم از `File.type` اعلامی **و هم** از امضای واقعیِ بایت‌ها (magic bytes) تأیید می‌شود — چون `File.type` را کلاینت پر می‌کند و به‌سادگی جعل‌پذیر است. سقفِ حجم ۳ مگابایت.
- **URLِ عکسِ paste‌شده (نه آپلود):** محصول/تنظیماتِ لوگو اجازه می‌دهند به‌جای آپلود یک URL دلخواه وارد شود. `lib/url.ts::isSafeImageUrl` قبل از ذخیره فقط `http:`/`https:` یا مسیرِ نسبیِ هم‌مبدأ (`/...`) را می‌پذیرد و `javascript:`/`data:`/`vbscript:`/`file:` و آدرسِ protocol-relative (`//host`) را رد می‌کند — در سه نقطه اعمال می‌شود: `api/product-images`, `api/products` (`imageUrl`), `api/settings/tenant` (`logoUrl`).
- **ورودی‌های PATCH نمایندگی‌ها/انبارها:** فیلدهای `body` قبل از رسیدن به UPDATEِ parameterized با گاردِ نوعِ محلی (`str`/`bool`/`strOrNull`) تأیید می‌شوند — بدونش یک فیلدِ اشتباه‌تایپ‌شده در JSON می‌توانست ستونی را با مقدارِ غیرمنتظره بازنویسی کند. `strOrNull` سه‌حالته است (`undefined`=دست‌نزن، `null`=پاک‌کن، رشته=ست‌کن) چون `priceListId`/`assignedStaffUserId` باید صریح قابلِ پاک‌کردن بمانند.
- **Clickjacking:** `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`.
- **سایر هدرها:** `nosniff`، `Referrer-Policy`، `Permissions-Policy`، حذف `X-Powered-By` (`next.config.ts`).
- **CSP کاملِ `script-src` با nonce پیاده شده:** `src/middleware.ts` هر request یک nonceِ تصادفیِ تازه می‌سازد و در هدرِ ریسپانس (`Content-Security-Policy: script-src 'self' 'nonce-…' 'strict-dynamic'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`) می‌گذارد؛ همان nonce از هدرِ `x-nonce` به `layout.tsx` می‌رسد و به `<script>`ِ دستیِ آن اعمال می‌شود — Next خودش هم اسکریپت‌های فریم‌ورکی (hydration/streaming) را با همین nonce امضا می‌کند، پس `'unsafe-inline'` لازم نیست. در dev فقط `'unsafe-eval'` هم اضافه می‌شود (React برای stack trace لازمش دارد)، در production هرگز. هزینه: خواندنِ `headers()` در ریشه‌ی layout همه‌ی صفحات را از استاتیک به دینامیکِ per-request می‌برد — trade-off آگاهانه، نه رگرسیون.
- **CSV/Excel formula injection:** فعلاً export نداریم. **اگر اضافه شد**، مقادیری که با `= + - @` شروع می‌شوند باید escape شوند (spec ۸).

---

## ۶. توابعِ `SECURITY DEFINER` — تنها جاهایی که RLS دور زده می‌شود

چهار تابع عمداً از RLS عبور می‌کنند. هرکدام دلیل و محدودیت دارد:

| تابع | چرا لازم است | چرا امن است |
|---|---|---|
| `user_contexts(user_id)` | «کاربر عضو کدام tenantهاست؟» ذاتاً cross-tenant است و قبل از انتخاب tenant اجرا می‌شود | فقط برای `p_user_id` ردیف می‌دهد و اپ همیشه userIdِ **احرازشده از JWT** را می‌دهد، هرگز ورودی کلاینت |
| `expire_due_reservations()` | نگهداریِ cross-tenant | ورودی ندارد؛ فقط رزروهایی را که خودشان از مهلت گذشته‌اند علامت می‌زند؛ داده برنمی‌گرداند |
| `claim_pending_notifications()` | worker به هیچ tenantی تعلق ندارد | فقط صفِ پیام؛ ورودیِ tenant نمی‌گیرد |
| `finish_notification()` | همان | فقط وضعیتِ یک پیام را ثبت می‌کند |

همه با `REVOKE EXECUTE ... FROM PUBLIC` و GRANT صریح به نقشِ اپ.

### ۶.۱ `SET search_path` — قفلِ حیاتی (Phase 10-post)

هر چهار تابع حالا `SET search_path = public, pg_temp` دارند. بدون این، `SECURITY DEFINER`
خودش سطحِ حمله است: مهاجم با ساختنِ شیء هم‌نام در schemaیِ قابلِ‌نوشتن، می‌توانست
تابع را به کدِ خودش هدایت کند (search_path injection). `pg_temp` در این فهرست امن است
چون Postgres خودش مدیریتش می‌کند، نه قابلِ کاشتِ مخرب.

> **قانون:** هر تابع `SECURITY DEFINER` که ساخته می‌شود، باید `SET search_path` داشته باشد.
> بدون آن، تابع در برابرِ مهاجمی که روی schemaیِ قابلِ‌نوشتن دسترسی دارد، آسیب‌پذیر است.

> **این بخش را سرسری نگیر:** هر تابع `SECURITY DEFINER` که ورودیِ tenant/id از کلاینت بگیرد و بر اساسش داده برگرداند، یک دور زدنِ کاملِ RLS است. قانون: **هرگز شناسه‌ای که کلاینت داده را به این توابع پاس نده.**

**درسِ عملی از همین پروژه:** worker پیامک اولش کوئریِ مستقیم می‌زد. چون `notification_outbox` ستون `tenant_id` دارد، RLS رویش فعال بود و worker زیر نقشِ واقعی **صفر ردیف** می‌دید — یعنی در production تا ابد `sent=0` گزارش می‌داد و هیچ پیامکی نمی‌رفت، بدون هیچ خطایی. در dev دیده نشد چون superuser بودیم. اثبات: همان کوئری، `1` ردیف به‌عنوان owner و `0` به‌عنوان `app_user`.

---

## ۷. اسرار

- `web/.env` در `.gitignore` است؛ در ریپو هیچ رازی commit نشده (`.env.example` فقط placeholder دارد).
- `AUTH_SECRET` باید تصادفیِ ۳۲بایتی باشد (`openssl rand -base64 32`). با عوض‌شدنش همه‌ی نشست‌ها باطل می‌شوند — که تنها راهِ فعلیِ «خروج اجباریِ همه» است.
- رمز دیتابیس فقط در `.env` سرور.
- اگر رازی لو رفت: `AUTH_SECRET` را عوض کن (همه بیرون می‌روند)، رمز DB را بچرخان، لجر و `audit_log` را برای فعالیتِ مشکوک بررسی کن.

---

## ۸. پاسخ به حادثه (کوتاه)

| علامت | اولین کار | بعد |
|---|---|---|
| موجودی مشکوک/غلط | `/staff/ledger` → ناترازی | لجر می‌گوید چه کسی، کِی، چقدر. اصلاح **با تراکنش معکوس**، نه `UPDATE` دستی |
| تغییرِ مشکوکِ قیمت/سقف/محصول/مشتری | `/staff/reports` → دفترِ تغییرات (`audit_log`) | چه کسی، از چه به چه — فقط فیلدهای واقعاً تغییرکرده |
| ادعای نشتِ بین‌تننتی | تأیید کن اپ با نقشِ non-superuser وصل است | `scripts/prodlike-smoke.sh` را اجرا کن؛ تست‌های IDOR را ببین؛ Sentry را با `tenantId`/`userId` فیلتر کن (هر authorize موفق برچسب می‌زند) |
| brute-force روی ورود | rate limit خودش می‌گیرد (۴۲۹) | لاگ IP؛ در صورت نیاز در پروکسی ببند |
| پیامک‌ها نمی‌روند | `notification_outbox` با `status='failed'` | dead-letter بعد از ۵ تلاش؛ لاگ worker |
| نشست لو رفته | کاربر رمز را عوض کند یا staff از `/api/auth/logout-all` برایش بزند | نیازی به عوض‌کردنِ `AUTH_SECRET` نیست — `session_epoch` فقط همان کاربر را می‌کشد |

---

## ۹. آنچه هنوز نداریم (صادقانه)

- 2FA / OTP پیامکی برای ورودِ روزمره (فقط بازیابیِ رمز کدِ پیامکی دارد).
- تفکیکِ ریزترِ نقش‌ها (فعلاً `admin`/`staff`/`agent`؛ `agent_admin` در برابر `agent_operator` نداریم).
- پایشِ خودکار و هشدار (spec عمداً Prometheus را در این مرحله رد کرده). Sentry خطاهای runtime را می‌گیرد (با برچسبِ tenant/user)؛ بررسیِ `notification_outbox`/`import_row` هنوز هفتگی و دستی است.
- ~~اسکنِ خودکارِ وابستگی‌ها در CI — چون **اصلاً CI نداریم**؛ `npm audit` هنوز فقط دستی اجرا می‌شود~~ ✅ رفع شد (Phase 10-post): `.github/workflows/ci.yml` با PostgreSQL داکری، typecheck، test، build. `npm audit` همچنان دستی است ولی `npm ci` در CI اجرا می‌شود.

## ۹.۱. رفع‌های Phase 10-post (حسابرسیِ امنیتیِ خارجی)

این موارد پس ازِ حسابرسیِ اصلی، بر اساسِ بازبینیِ یک مدل AI دیگر رفع شدند:

| رفع | فایل | چرا مهم بود |
|---|---|---|
| `SET search_path = public, pg_temp` روی هر چهار تابع `SECURITY DEFINER` | `db/schema.sql` | جلوی search_path injection را می‌گیرد — بدونش، SECURITY DEFINER خودش سطحِ حمله است |
| ساختارِ `db/migrations/` با `apply.ts` و جدول `_migrations` | `db/migrations/` | migrationهای forward-only با checksum validation — هرگز روی prodِ داده‌دار schema.sql اجرا نکن |
| حذفِ فایلِ فیزیکی در `removeProductImage` | `web/src/db/products.ts` + `web/src/lib/fileCleanup.ts` | جلوی انباشتِ فایل‌های یتیم (orphan) در `public/uploads/` را می‌گیرد |
| Rate limiter دو-حالته (`RATE_LIMIT_BACKEND=memory\|postgres`) | `web/src/auth/rateLimit.ts` + `db/migrations/0003_rate_limit_table.sql` | multi-instance: سقفِ واقعاً global، نه ضرب‌شده در تعداد پروسه‌ها |
| GitHub Actions CI | `.github/workflows/ci.yml` | جلوی مرجِ کدِ تست‌نشکسته را می‌گیرد |
| Dockerfile multi-stage + docker-compose | `Dockerfile`, `docker-compose.yml` | production-ready با non-root کاربر و volume ماندگار |

## ۱۰. قبل از هر دیپلوی

```bash
bash scripts/prodlike-smoke.sh   # اپ با نقشِ محدود و RLS واقعاً فعال
cd web && npm test               # ۲۳۰+ تست، شامل IDOR و یکپارچگی موجودی
```
