# CHANGELOG

قالب: [Keep a Changelog](https://keepachangelog.com/). تاریخ‌ها نسبی‌اند چون پروژه پیش از انتشار است.
منبع دقیق، تاریخچه‌ی git است؛ این‌جا فقط نقاط عطفِ خوانا.

## [Unreleased]

### Added
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
