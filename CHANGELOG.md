# CHANGELOG

قالب: [Keep a Changelog](https://keepachangelog.com/). تاریخ‌ها نسبی‌اند چون پروژه پیش از انتشار است.
منبع دقیق، تاریخچه‌ی git است؛ این‌جا فقط نقاط عطفِ خوانا.

## [Unreleased]

### Added
- **`docs/GO_LIVE.md`** — چک‌لیستِ کاملِ آنلاین‌شدن: نقش‌های DB (اپ نباید superuser یا مالکِ جدول باشد وگرنه RLS دور می‌خورد)، env، HTTPS اجباری (کوکی در production `Secure` است)، پروکسی و `X-Forwarded-For` برای rate limit، سقفِ limiter در حالت چند-instance، دو cron، بک‌آپ ایران→خارج با retry، سیاست migration، SQL راه‌اندازیِ اولین کارخانه/کاربر (فرم ثبت‌نام عمداً نداریم)، تصمیم‌های بازِ مصاحبه، و تست دودِ بعد از دیپلوی.
- **دفتر حرکات موجودی + تطبیق (`/staff/ledger`, `/api/ledger`):** لجری که از روز اول در هر عملیات می‌نوشتیم حالا خوانا شد — دلیلِ وجودش طبق spec ۵.۴ («چرا موجودی این کالا اشتباهه؟»). گزارشِ **ناترازی**: برای هر Lot باید `SUM(on_hand_delta) == on_hand` و `SUM(allocated_delta) == allocated`؛ هر اختلافی یعنی موجودی از مسیری عوض شده که لجر ننوشته. تست: کلِ زنجیره (import→رزرو→تأیید→بارگیری) ناترازیِ صفر می‌دهد، و UPDATE دستی دقیقاً گرفته می‌شود.

### Fixed
- **صفحه‌ی تطبیق fail-open بود:** روی خطای بارگذاری (مثلاً ۴۰۳ برای نماینده) سبز نشان می‌داد «✓ تراز است» — یعنی صفحه‌ای که ادعای ایمنی می‌کند، وقتی هیچ داده‌ای نگرفته بود هم مطمئن به نظر می‌رسید. حالا «بارگذاری موفق و خالی» از «بارگذاری ناموفق» تفکیک شده.

### Added (قبلی)
- **StockAlert + Outbox پیامک (آخرین فیچرِ v1، spec ۵.۹):** نماینده روی کالای ناموجود «خبرم کن» می‌زند؛ به‌محض اینکه import موجودی بیاورد، پیام **در همان تراکنشِ import** صف می‌شود (الگوی Outbox — اگر import رول‌بک شود پیامِ دروغینِ «موجود شد» هم نمی‌ماند) و `stock_alert` مصرف می‌شود (یک‌بارمصرف، پس اسپم ممکن نیست). worker `npm run worker:outbox` با الگوی claim-then-send: claim اتمیک با `FOR UPDATE SKIP LOCKED` (دو worker یک پیام را دوبار نمی‌فرستند)، ارسال بیرون از تراکنش، retry تا ۵ بار و بعد dead-letter (`failed`). فرستنده pluggable است (`SMS_PROVIDER`، پیش‌فرض `log`) چون اعتبارنامه‌ی پنل ایرانی نداریم — فقط همان یک تابع برای پروداکشن عوض می‌شود. ۴ تست جدید (۳۲/۳۲).

### Added (قبلی)
- **چرخه‌ی انقضای رزرو + خروج:** worker بوک‌کیپینگِ انقضا (`expire_due_reservations()` + `npm run worker:expire` برای cron هر ۱۰-۱۵ دقیقه، spec ۵.۳) که رزروهای از مهلت گذشته را `active→expired` می‌کند — **درستیِ `available` به آن وابسته نیست** (held همیشه `expires_at > now()` را شرط می‌کند)، پس تأخیر/شکستش بی‌خطر است. خروج (`POST /api/auth/logout`، POST نه GET تا با CSRF نشود کاربر را خارج کرد) + دکمه‌ی خروج در صفحات نماینده و staff.

### Fixed
- **صفِ تأیید، رزروهای منقضی را «در انتظار تأیید» نشان می‌داد** — کوئری فقط `status='active'` را فیلتر می‌کرد و چون worker انقضا وجود نداشت، رزروِ منقضی برای همیشه `active` می‌ماند. حالا (۱) صفِ staff شرطِ `expires_at > now()` دارد و (۲) وضعیتِ نمایشی در SQL مشتق می‌شود (`CASE ... THEN 'expired'`) تا حتی با تأخیرِ worker هم درست باشد. این دقیقاً همان چیزی است که spec هشدار داده بود: هرگز فقط به `status` تکیه نکن.

### Added (قبلی)
- **سخت‌سازیِ امنیت (spec ۸):** rate limiting روی لاگین (دولایه: per-IP ۲۰/۱۵دقیقه + per-phone ۵/۱۵دقیقه — جلوی brute-force از IPهای چرخان)، رزرو (۳۰/دقیقه per-user) و import (۱۰/ساعت). پاسخ ۴۲۹ با `Retry-After`. هدرهای امنیتی در `next.config.ts`: `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`، `nosniff`، `Referrer-Policy`، `Permissions-Policy`، و حذف `X-Powered-By`. ۳ تست واحد + تأیید زنده روی سرور (۵ تلاش → ۴۲۹ با Retry-After 899).

### Fixed
- **پنل staff روی «در حال بارگذاری…» قفل می‌شد** — `user_contexts()` با INNER JOIN به `agent_account_user` بسته شده بود، پس کاربرِ staff (که به هیچ نمایندگی وصل نیست) صفر context می‌گرفت و همه‌ی صفحه‌ها منتظر می‌ماندند. با LEFT JOIN + برگرداندن `role` حل شد؛ صفحات نماینده هم حالا نبودِ `agentAccountId` را با پیام مدیریت می‌کنند به‌جای هنگ. این باگ فقط با اجرای واقعیِ اپ در مرورگر پیدا شد (تست‌های API چون `tenantId` را مستقیم می‌فرستادند از کنارش رد می‌شدند). تست رگرسیون schema (تست ۶) اضافه شد.

### Added (قبلی)
- **Import اکسل (snapshot، spec ۱۴.۵):** موتور تطبیقِ اتمیک `applySnapshot` — درد اصلیِ کارخونه (اکسل دستی). قواعد خطرناک رعایت‌شده و تست‌شده: فقط `on_hand`؛ ردیفِ غایب فقط **داخل scope اعلام‌شده** صفر می‌شه (نه کل tenant)؛ `on_hand` هرگز زیر `allocated+blocked` نمی‌ره (guardِ below_committed + absent_but_committed)؛ idempotent با `ImportBatch`. پارسِ `.xlsx` سمتِ **مرورگر** (SheetJS) → هیچ فایلی به سرور نمی‌رسه (سطحِ حمله‌ی upload حذف). endpoint `/api/imports` (staff)، صفحه‌ی `/staff/import`. ۴ تست حیاتی (scope isolation, below_committed, absent_but_committed, idempotency) + e2e (staff 201/agent 403/dedupe). **کلِ v1 حالا فیچرکامل است.**
- **مسیر backorder (محصول ناموجود، spec ۵.۶):** حواله‌ی مستقلِ backorder (بدون SalesRequest، `lot_id=NULL`) که **هیچ ردیف موجودی/لجری را دست نمی‌زند** — تعریفِ کلیدیِ backorder. چرخه‌ی `backorder_status` (pending_production→ready→fulfilled|cancelled) روی هر item، با guard. endpointها: POST `/api/sales-dispatches` (branch با `items`), POST `/api/backorders/:itemId/status`, GET `/api/backorders|agents|catalog`. پنل staff: فرم ثبت backorder + لیست با گذارِ وضعیت. ۴ تست جدید (۲۱/۲۱) + e2e (staff 201/agent 403/موجودی دست‌نخورده). زنجیره‌ی فروش حالا کامل: چه موجود چه ناموجود.
- **نقش‌محوری (role-based authz):** `tenant_membership.role` با CHECK (`admin`/`staff`/`agent`). تأیید تجاری و ساخت/بارگیریِ حواله حالا **staff-only** (`authorizeStaff`)؛ نماینده ۴۰۳ می‌گیرد. تأیید از صفحه‌ی نماینده به پنل staff منتقل شد (staff رزروهای active همه‌ی نماینده‌ها را می‌بیند و تأیید می‌کند). ۳ تست نقش (unit) + e2e گسترش‌یافته با دو نشست (نماینده/staff) که ۴۰۳/۲۰۱ را اثبات می‌کند.
- **UI کامل زنجیره:** صفحه‌ی `/reservations` (رزروهای من + دکمه‌ی تأیید) و `/staff` (درخواست‌های تأییدشده → ساخت حواله → گذارِ وضعیت تا loaded/delivered/cancel). read endpointها: `GET /api/reservations`, `GET /api/sales-requests`, `GET /api/sales-dispatches`. کل زنجیره از طریق HTTP روی سرور زنده تست شد (۱۴ چک، شامل تأییدِ کم‌شدنِ فیزیکیِ on_hand ۵۰→۴۰).
- **SalesDispatch + گذارِ `loaded`** (`dispatches.ts` + `/api/sales-dispatches` و `/:id/status`): ساخت حواله از SalesRequestِ تأییدشده، و بارگیریِ فیزیکی که `on_hand` و `allocated` را اتمیک کم می‌کند (spec ۱۴.۳). idempotent و state-guarded (بارگیریِ دوباره double-decrement نمی‌کند)؛ لغوِ قبل از بارگیری `allocated` را آزاد و request را cancelled می‌کند. حلقه‌ی آخرِ زنجیره‌ی موجودی. ۳ تست جدید (۱۴/۱۴ سبز).
- **الگوریتم Approval** (`salesRequests.ts` + `POST /api/reservations/:id/approve`): تبدیل رزرو → SalesRequest تأییدشده، جابه‌جاییِ اتمیکِ `held → allocated` بدون گپ زمانی (spec ۱۴.۲). قفل `ORDER BY lot_id`، guardِ `active`+منقضی‌نشده، ضدِ double-allocate. ۳ تست جدید (۱۱/۱۱ سبز).
- اسناد کنترلی MVP در `docs/`: PRD، ARCHITECTURE، API_SPEC، DATABASE_SCHEMA، CODING_STANDARDS، AI_CONTEXT، KNOWN_ISSUES + README ریشه و این CHANGELOG.
- اولین UI نماینده: `/login` و `/reserve` (RTL فارسی، pending-state، خطای ۴۰۹ «موجودی فعلی: X»، هشدار نرم مخلوط شید). — `83d908f`
- endpointها: `/api/auth/login`, `/api/me`, `/api/lots`, `/api/reservations`.
- پایه‌ی auth: bcryptjs + jose (JWT کوکی HttpOnly) + chokepoint دسترسی `authorizeAgent` (ضدِ IDOR). — `db1e281`
- اسکلت Next.js + Drizzle(introspect) + الگوریتم رزرو (`reservations.ts`). — `2ed87fe`
- DDL کامل Postgres (`db/schema.sql`) + تست دود (`db/test_schema.sql`). — `3c2f6d6`
- wireframe متنی UX نماینده. — `38de027`
- سند جامع محصول + CLAUDE.md؛ بخش ۷ با پیش‌فرض‌های تحقیق‌شده پر شد. — `8ad9bce`, `d41975a`

### Changed / Fixed
- **بازبینی چند-مدلی v7.1** (`5976f6d`): حذف `partially_converted` (ناسازگار با held)؛ idempotency به `UNIQUE(tenant_id,key)` + payload-hash؛ افزودن `sqcm_per_box`/`pieces_per_box`؛ `line_no` جای `UNIQUE(request_id,variant_id)`؛ CHECK قوی‌تر dispatch + FK سازگاریِ lot↔variant؛ FK `agent_account_user→tenant_membership`؛ `audit_log.old/new_value`؛ import scope. + بخش ۱۴ spec (الگوریتم approve/load/cancel، RLS عملیاتی، IRR/UTC، migration، زیرساخت ایران).
- کوکی نشست فقط در production `Secure` (در dev/http لاگین نمی‌شکند).
- cast `held`/`available` به int در VIEW (SUM بیگ‌اینت رشته برمی‌گرداند).

### تست‌ها (سبز در هر نقطه‌ی عطف)
schema smoke ۵/۵ · unit (reserve+authz) ۸/۸ · end-to-end ۸/۸ روی سرور زنده · `tsc` پاک · `next build` سبز.

---
> نسخه‌گذاری معنایی (SemVer) از اولین release عمومی شروع می‌شود. تا آن موقع همه‌چیز زیر `Unreleased`.
