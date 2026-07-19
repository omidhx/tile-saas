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
  { "tenantId": "…", "tenantName": "…", "agentAccountId": "…", "agentLegalName": "…" }
] }
// 401 → { "error": "unauthenticated" }
```

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

## Planned (هنوز ساخته نشده — قرارداد پیشنهادی)
| endpoint | کار | مرجع الگوریتم |
|---|---|---|
| `GET /api/reservations` (mine) | رزروهای نماینده + TTL | فیلترِ `agent_account_id` (spec ۱۴.۶) |
| `POST /api/sales-dispatches` (backorder مستقل) | حواله بدون request (backorder) | spec ۵.۶ |
| `POST /api/sales-dispatches/:id/status` | `loaded` (idempotent، on_hand↓) | spec ۱۴.۳ |
| `POST /api/import/batches` | آپلود اکسل snapshot | spec ۱۴.۵ |

## Rate limits (planned)
روی login/reservation/import/dispatch-transition. spec ۸/۱۴.۶.

## Assumptions
- کلاینت `idempotencyKey` را UUIDv4 تولید می‌کند و برای retryِ همان عملیات همان را می‌فرستد.

## Open Questions
- آیا `openapi.yaml` نگه‌داریم؟ وقتی مصرف‌کننده‌ی بیرونی (اپ موبایل) اضافه شد، بله.
- قیمت در پاسخ `lots` بیاید؟ به تصمیم «نمایش قیمت» وابسته (PRD Decision Log).

## Decision Log
- خطای موجودی = `409` (نه `422`) تا کلاینت با `onError` کش را invalidate کند (spec ۱۱.۲).
