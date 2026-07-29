# API_SPEC — قرارداد Frontend ↔ Backend

> منبع حقیقتِ رفتار، خودِ route handlerها در [../web/src/app/api/](../web/src/app/api/) هستند. این سند قرارداد را خوانا می‌کند و باید با آن‌ها هم‌گام بماند. endpointهای «planned» هنوز ساخته نشده‌اند.
> همه‌ی بدنه‌ها JSON‌اند. auth با کوکیِ نشستِ HttpOnly (`session`) که `POST /api/auth/login` ست می‌کند.

## قواعد عمومی
- **Authorization**: هر endpointِ دامنه‌ای اول `currentUserId()` (از JWT) بعد `authorizeAgent(userId, tenantId, agentAccountId)`. مقادیر tenant/agent از body **باور نمی‌شوند** — در برابر DB تأیید می‌شوند.
- **کدهای خطا:** `400` بدنه‌ی نامعتبر · `401` احراز نشده · `403` مجاز نیست (IDOR) · `409` تعارض (موجودی یا idempotency) · `201/200` موفق.
- `tenant_id`/`agent_account_id`/همه‌ی idها UUID.

---

## `POST /api/auth/login`
ورود با موبایل + رمز. پیام خطا عمداً یکسان (عدم افشای وجود کاربر).
```jsonc
// Request
{ "phone": "09120000000", "password": "…" }
// 200 → کوکی session ست می‌شود، بدنه:
{ "ok": true }
// 401
{ "error": "invalid credentials" }
```

## `GET /api/me`
context‌های کاربر (کدام tenant/نمایندگی). از `user_contexts` (SECURITY DEFINER، عبور امن از RLS).
```jsonc
// 200
{ "contexts": [
  { "tenantId": "…", "tenantName": "…", "agentAccountId": "…", "agentLegalName": "…",
    "role": "staff", "canManageAccess": false, "allowedPages": [],
    "assignedStaffName": null, "assignedStaffPhone": null }
] }
// 401 → { "error": "unauthenticated" }
```
- `allowedPages` خالی یعنی دسترسیِ کامل (پیش‌فرضِ سازگار با قبل)؛ `canManageAccess` فقط برای `role="admin"` معنا دارد.
- `assignedStaffName`/`assignedStaffPhone` فقط وقتی `agentAccountId` پر است معنا دارند (پشتیبانِ ثابتِ همان نمایندگی).

## `GET /api/lots?tenantId=…&agentAccountId=…`
Lotهای قابل‌سفارش برای یک context. فقط `available>0`. **هرگز `bin_location` برنمی‌گرداند.**
```jsonc
// 200
{ "lots": [
  { "lot_id": "…", "name": "گرانیت مشکی", "code": "GB-6060", "grade": "1",
    "shade_code": "A", "caliber_code": "2", "available": 40,
    "boxes_per_pallet": 96, "sqcm_per_box": 14400 }
] }
// 403 → { "error": "forbidden" }   401 → { "error": "unauthenticated" }
```
- `available` = `on_hand − held − allocated − blocked` (INT). متراژ در UI: `available × sqcm_per_box / 10000`.

## `POST /api/reservations`
رزرو all-or-nothing. ورودی lot-based.
```jsonc
// Request
{ "tenantId": "…", "agentAccountId": "…",
  "idempotencyKey": "<uuid v4 سمت کلاینت>",
  "items": [ { "lotId": "…", "quantityBoxes": 10 } ] }
// 201 (جدید) یا 200 (idempotent، همان کلید+payload)
{ "reservationId": "…" }
// 409 موجودی کم:
{ "error": "conflict", "lotId": "…", "requested": 999, "available": 40 }
// 409 کلید تکراری با payload متفاوت:
{ "error": "idempotency_key_conflict" }
// 400 بدنه‌ی نامعتبر · 401 · 403
```
- `ttlHours` از خودِ tenant خوانده می‌شود، نه کلاینت.
- الگوریتم: [reservations.ts](../web/src/db/reservations.ts) / spec ۶.

## `POST /api/reservations/:id/approve`
تأیید رزرو → SalesRequest تأییدشده. جابه‌جاییِ اتمیکِ `held → allocated` (spec ۱۴.۲) بدون گپ زمانی.
```jsonc
// Request
{ "tenantId": "…", "agentAccountId": "…" }
// 201
{ "salesRequestId": "…" }
// 404 رزرو یافت نشد/مالِ این agent نیست: { "error": "not_found" }
// 409 منقضی یا قبلاً تبدیل‌شده:       { "error": "reservation_not_active" }
// 400 · 401 · 403
```
- در یک تراکنش: قفل balanceها `ORDER BY lot_id` → guardِ `status='active' AND expires_at>now()` → SalesRequest(approved) + item(per variant, line_no) + allocation(per lot) + `allocated += qty` + لجر. الگوریتم: [salesRequests.ts](../web/src/db/salesRequests.ts).
- **ponytail:** فعلاً role-gate ندارد (تأیید تجاری معمولاً staff است) — وقتی نقش staff/agent اضافه شد گیت شود.

---

## `POST /api/sales-dispatches` (staff)
ساخت حواله از یک SalesRequestِ تأییدشده. اقلام in_stock از allocationها. auth: عضو tenant.
```jsonc
// Request
{ "tenantId": "…", "salesRequestId": "…", "dispatchCode": "D-001", "customerName": "…", "destination": "…" }
// 201 → { "dispatchId": "…" }
// 404 request_not_found · 409 request_not_approved | no_allocations · 400 · 401 · 403
```

## `POST /api/sales-dispatches/:id/status` (staff)
گذارِ وضعیت. `loaded` → کم‌شدنِ اتمیکِ `on_hand`/`allocated` (spec ۱۴.۳)، idempotent و state-guarded.
```jsonc
// Request
{ "tenantId": "…", "toStatus": "loaded" }   // registered|ready_for_loading|loaded|delivered|cancelled
// 200 → { "status": "loaded" }
// 404 not_found · 409 invalid_transition · 400 · 401 · 403
```
- گذارها: registered→ready_for_loading→loaded→delivered؛ لغو فقط قبل از loaded (allocated آزاد می‌شه + request مرتبط cancelled). `loaded→cancelled` ممنوع. الگوریتم: [dispatches.ts](../web/src/db/dispatches.ts).

---

## فهرست کاملِ endpointها
> این جدول باید با پوشه‌ی `web/src/app/api/` یکی بماند — تستِ
> `web/src/db/docsDrift.test.ts` اگر endpointی مستند نشده باشد **شکست می‌خورد**.

| endpoint | نقش | کار |
|---|---|---|
| `/api/auth/login` `/logout` | همه | ورود/خروج |
| `/api/auth/password` | واردشده | تغییر رمز (نشست‌ها را باطل می‌کند) |
| `/api/auth/reset` | عمومی | بازیابی با کدِ پیامکی — وجودِ شماره را لو نمی‌دهد |
| `/api/auth/logout-all` | واردشده | خروج از همه‌ی دستگاه‌های دیگر |
| `/api/me` | واردشده | contextهای کاربر (`user_contexts`) |
| `/api/lots` | نماینده | موجودیِ قابل‌سفارش + «قیمت من» + انبار |
| `/api/reservations` (+`/:id/approve` `/:id/cancel`) | نماینده/staff | رزرو، تأیید، لغو |
| `/api/alerts` | نماینده | «خبرم کن» + ناموجودها + **جایگزین‌ها** + **موجودی در راه** |
| `/api/waitlist` | نماینده | صف انتظار (نوبت گرفتن/انصراف) |
| `/api/sales-requests` | staff | سفارش‌های تأییدشده (+`approvalMode`) |
| `/api/sales-dispatches` (+`/:id/status`) | staff | حواله (**آرایه** — چندانباره) و گذارِ وضعیت |
| `/api/backorders` (+`/:itemId/status`) | staff | backorder |
| `/api/imports` | staff | ورودِ اکسل snapshot |
| `/api/prices` | staff | قیمت‌گذاری (تغییر در `audit_log` ثبت می‌شود) |
| `/api/settings/auto-approve` | staff | سقفِ تأیید خودکار (تغییر در `audit_log`) |
| `/api/substitutes` | staff | تعریفِ کالای جایگزین |
| `/api/products` | staff | مدیریتِ محصول: فهرست (با قیمت/گالری/فیلدهای بیشتر/بسته‌بندی)، `POST` ساخت، `PATCH` ویرایشِ ویژگی‌ها + بسته‌بندیِ variant اول (`boxesPerPallet`/`sqcmPerBox`، برای فرمولِ تبدیلِ کارتن⇄پالت⇄مترمربع در `/reserve`؛ کد/sku قفل؛ عکس‌ها در `/api/product-images`). `POST` اختیاراً `initialStock: {warehouseId, quantityBoxes}` می‌گیرد — موجودیِ اولیه از همان مسیرِ لجرِ import/incoming (`transaction_type='initial_stock'`)، نه UPDATE مستقیم |
| `/api/upload` | staff | آپلودِ عکس (multipart) → URL برمی‌گرداند |
| `/api/product-images` | staff | گالریِ محصول: `POST` افزودن، `PATCH` اصلی‌کردن، `DELETE` حذف |
| `/api/shared-catalog` | agent | کاتالوگِ سفارشیِ نماینده: فهرست/ساخت/باطل‌کردن/حذف. صفحه‌ی عمومیِ مشتری در `/c/<slug>/<token>` (بدونِ لاگین، فقط عکس/مشخصات/موجود، بدونِ قیمت) |
| `/api/incoming` | staff | موجودی در راه؛ `PATCH action=arrive` وارد لجر می‌کند |
| `/api/customers` | staff | مشتری‌ها + گزارشِ پرخریدترین + تاریخچه |
| `/api/reports` | staff | گزارش‌های مدیریتی |
| `/api/ledger` | staff | دفتر حرکات + تطبیق (drift) |
| `/api/audit` | staff | دفتر تغییراتِ قواعدِ پولی |
| `/api/catalog` | staff | فهرستِ کمکیِ محصولات |
| `/api/agents` | staff (GET ساده) / admin (`detail=1`، `POST`، `PATCH`، `DELETE`) | فهرستِ کمکی برای فرم backorder؛ مدیریتِ کامل (ساخت + کاربرِ اول، ویرایش، افزودنِ کاربرِ دیگر، تخصیصِ `assignedStaffUserId` به‌عنوانِ پشتیبانِ ثابت، حذفِ واقعی با گاردِ سابقه) برای admin. `detail=1` یک `staffOptions` هم برمی‌گرداند (برای دراپ‌داونِ انتخابِ پشتیبان) |
| `/api/warehouses` | staff (GET) / admin (`POST`/`PATCH`/`DELETE`) | فهرست؛ ساخت/تغییرِ نام/حذف برای admin (حذف فقط بدونِ سابقه — گاردِ `has_history`) |
| `/api/team` | admin + مدیرِ دسترسی (`can_manage_access`) | اعضای تیمِ پشتیبان/مدیر: دعوت با موبایل(+ایمیلِ اختیاری+نامِ اختیاری، find-or-create روی `app_user` سراسری)، تغییرِ نقش/فعال‌بودن/دسترسیِ ریزدانه (`allowedPages`)/نام، حذفِ واقعی (گاردِ last_admin/last_deputy/linked_to_agent) |
| `/api/platform/tenants` | مدیرِ پلتفرم (`app_user.is_platform_admin`) | v9 — روزِ صفرِ مشتریِ تازه: `POST` یک tenant + اولین کاربرِ admin (که `can_manage_access` هم دارد) در یک تراکنش می‌سازد؛ بدونِ SQL دستی |

## Rate limits
پیاده‌شده روی: `login`، `reservations` (۳۰/دقیقه per user)، `auth/password` (۵/۱۵دقیقه)،
`auth/reset` (درخواست ۳ و تأیید ۱۰ در ۱۵ دقیقه، per phone). spec ۸/۱۴.۶.

## Assumptions
- کلاینت `idempotencyKey` را UUIDv4 تولید می‌کند و برای retryِ همان عملیات همان را می‌فرستد.

## Open Questions
- آیا `openapi.yaml` نگه‌داریم؟ وقتی مصرف‌کننده‌ی بیرونی (اپ موبایل) اضافه شد، بله.
- قیمت در پاسخ `lots` بیاید؟ به تصمیم «نمایش قیمت» وابسته (PRD Decision Log).

## Decision Log
- خطای موجودی = `409` (نه `422`) تا کلاینت با `onError` کش را invalidate کند (spec ۱۱.۲).
