# CHANGELOG

قالب: [Keep a Changelog](https://keepachangelog.com/). تاریخ‌ها نسبی‌اند چون پروژه پیش از انتشار است.
منبع دقیق، تاریخچه‌ی git است؛ این‌جا فقط نقاط عطفِ خوانا.

## [Unreleased]

### Added
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
