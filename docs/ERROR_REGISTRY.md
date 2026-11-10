# Error Registry

> **مرجع رسمی کدهای خطای API** — تمام خطاهایی که API برمی‌گرداند در این سند
> مستند شده‌اند. این سند با کد همگام است (توسط `docsDrift.test.ts` بررسی می‌شود).

---

## فرمت استاندارد خطا

تمام خطاهای API به‌صورت JSON برگردانده می‌شوند:

```json
{
  "error": "ERROR_CODE",
  "details": "optional human-readable message"
}
```

---

## کدهای خطا

| Code | HTTP Status | توضیح | مسیرهای استفاده‌کننده |
|---|---|---|---|
| `unauthenticated` | 401 | کاربر وارد نشده یا session منقضی شده | همه‌ی route‌های نیاز به auth |
| `forbidden` | 403 | کاربر احراز هویت شده اما دسترسی ندارد (نقش اشتباه یا tenant اشتباه) | staff/admin/platform routes |
| `invalid` | 400 | ورودی نامعتبر (بدنه، نوع، یا مقدار) | اکثر mutation routes |
| `invalid body` | 400 | بدنه‌ی request قابل parse نیست یا فیلدهای ضروری ندارد | mutation routes با JSON body |
| `not_found` | 404 | منبع مورد نظر وجود ندارد | /api/settings/tenant |
| `too_large` | 413 | فایل آپلودی بزرگ‌تر از حد مجاز (3MB) | /api/upload |
| `too_many` | 429 | Rate limit exceeded | /api/auth/login, /api/auth/password, /api/auth/reset, /api/upload, /api/imports, /api/reservations |
| `scope_not_found` | 404 | انبار یا برندِ دامنه‌ی ایمپورت در این tenant نیست | /api/imports |
| `idempotency_mismatch` | 409 | کلیدِ ایمپورتِ تکراری با فایلِ دیگر | /api/imports |
| `not_committed` / `not_latest` / `below_committed` | 409 | برگرداندن: قبلاً برگشته، آخرین ایمپورت نیست، یا موجودی را زیرِ تعهد می‌برد | DELETE /api/imports |
| `bad_type` | 415 | نوع فایل (MIME) مجاز نیست | /api/upload |
| `bad_range` | 416 | بازه‌ی درخواست نامعتبر است | /api/customers, /api/reports |
| `conflict` | 409 | تعارض منبع (مثلاً کد نماینده تکراری) | /api/agents |
| `idempotency_key_conflict` | 409 | کلید idempotency تکراری با payload متفاوت | /api/reservations |
| `reservation_not_active` | 409 | رزرو در وضعیت active نیست (قبلاً تبدیل یا لغو شده) | /api/reservations/[id]/approve, /api/reservations/[id]/cancel |
| `invalid_stock` | 400 | موجودیِ اولیه‌ی محصول نامعتبر | /api/products |
| `invalid_packaging` | 400 | نوع بسته‌بندی نامعتبر | /api/products |
| `invalid limit` | 400 | سقف تأیید خودکار نامعتبر | /api/settings/auto-approve |
| `missing_title` | 400 | عنوان موجود نیست | /api/shared-catalog |
| `no_items` | 400 | سفارش/حواله آیتم ندارد | /api/sales-requests, /api/sales-dispatches |
| `same_variant` | 400 | واریانت تکراری در یک درخواست | /api/sales-requests |
| `write_failed` | 500 | خطا در نوشتن فایل روی دیسک | /api/upload |
| `نام کاربری یا رمز اشتباه است` | 401 | شماره موبایل یا رمز عبور اشتباه | /api/auth/login |


### خطاهای ردیفِ ایمپورت

`POST /api/imports` با `preview: true` همیشه ۲۰۰ می‌دهد و خطاها در `errors` هستند. اعمالِ فایلی که حتی یک خطا دارد ۴۲۲ می‌دهد و هیچ چیزی نمی‌نویسد. بیش از ۵۰۰۰ ردیف: ۴۰۰ `invalid` با `fields: ["rows"]`.

| reason | توضیح |
|---|---|
| `missing_quantity` / `bad_quantity` | موجودی خالی، یا عددِ صحیحِ نامنفی نیست (اعشار، «1,5»، متن، تاریخ، بیش از INT) |
| `missing_sku` / `missing_warehouse` | کد یا انبار خالی است |
| `unknown_sku` / `unknown_warehouse` | کالا یا انبار نیست (کالای تازه ستونِ نام می‌خواهد) |
| `out_of_scope` | ردیف بیرون از دامنه‌ی انتخاب‌شده |
| `duplicate_row` / `duplicate_column` | دو ردیف برای یک lot، یا دو ستون برای یک فیلد |
| `ambiguous_lot` | دو lot با یک کلید |
| `below_committed` / `absent_but_committed` | عددِ فایل کمتر از تخصیص + بلوکه + رزروِ زنده، یا lotِ غایب که تعهد دارد |
| `missing_shade_caliber` | شید و کالیبر برای این کارخانه اجباری است |
| `bad_image_url` | آدرسِ عکس http(s) یا مسیرِ داخلی نیست |
| `empty_file` | فایل ردیفی ندارد |
| هشدار `new_lot_replaces` | lotِ تازه کنارِ lotِ صفرشونده‌ی همان کالا و انبار؛ اعمال ممکن است |

---

## Status Codes

| HTTP Status | معنا |
|---|---|
| 200 | موفق (GET, PATCH, DELETE) |
| 201 | ایجاد شد (POST) |
| 400 | Bad Request — ورودی نامعتبر |
| 401 | Unauthorized — احراز هویت نشده |
| 403 | Forbidden — دسترسی ندارد |
| 404 | Not Found |
| 409 | Conflict — تعارض |
| 413 | Payload Too Large |
| 415 | Unsupported Media Type |
| 429 | Too Many Requests — Rate limit |
| 500 | Internal Server Error |

---

## Rate Limit Error (429)

```json
{
  "error": "too_many",
  "retryAfter": 60
}
```

Header: `Retry-After: 60` (seconds)

---

## نگهداری

- این سند با کد همگام است — اگر error code جدیدی اضافه شود، باید این سند هم
  به‌روز شود.
- `docsDrift.test.ts` وجود route‌ها را در `API_SPEC.md` بررسی می‌کند.
- برای OpenAPI spec خودکار، در آینده از `next-swagger-doc` یا ابزار مشابه استفاده می‌شود.
