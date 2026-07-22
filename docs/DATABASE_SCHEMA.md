# DATABASE_SCHEMA

> **منبع حقیقت = [../db/schema.sql](../db/schema.sql).** این سند نقشه و قواعد را می‌دهد؛ ستون‌به‌ستون را کپی نمی‌کند (کپی سریع دروغ می‌شود). برای تعریف دقیق هر جدول، همان فایل را بخوان. تصمیم‌ها و استدلال: spec بخش ۵ و ۱۴.

## نقشه‌ی جدول‌ها (ERD خلاصه)
```
app_user (سراسری) ──< tenant_membership >── tenant
                          │                   │
tenant ──< agent_account ──< agent_account_user (FK به membership: کاربر باید عضو tenant باشه)
   │
   ├─ brand ──< product ──< product_variant ──< inventory_lot ──1:1─ inventory_balance
   │                                              │                     (on_hand/allocated/blocked)
   │                                              └──< inventory_transaction (لجر append-only)
   │
   ├─ reservation ──< reservation_item ─→ lot        (held = SUM active)
   ├─ sales_request ──< sales_request_item ──< sales_request_allocation ─→ lot
   ├─ sales_dispatch ──< sales_dispatch_item ─→ lot|NULL (backorder)
   ├─ price_list ──< price_list_item ;  agent_price_override ; volume_discount   (v2)
   ├─ customer ─→ sales_dispatch.customer_id  (نام روی حواله snapshot می‌ماند)      (v2)
   ├─ waitlist_entry (صف انتظار) ; product_substitute (جایگزین، جهت‌دار)            (v2)
   ├─ incoming_stock (موجودی در راه — **هرگز وارد available نمی‌شود**)              (v2)
   ├─ shared_catalog ──< shared_catalog_item (token در URL؛ customer_price اختیاری)  (v2)
   ├─ import_template ; import_batch (scope: tenant/warehouse/brand) ──< import_row
   └─ notification_outbox ; stock_alert ; audit_log (old/new JSONB)

app_user.session_epoch  ──  نسخه‌ی نشست؛ هر تغییر/بازیابیِ رمز یکی جلو می‌بردش
password_reset          ──  کدِ یک‌بارمصرفِ بازیابی (hash می‌شود، نه خودِ کد)
shared_catalog.token    ──  ظرفیتِ دسترسیِ عمومی؛ URL شاملِ slug است تا tenant پیدا و RLS ست شود
                            (صفحه‌ی مشتری نشست ندارد). is_active=false = لینکِ باطل، بدونِ حذف.
```

## قواعدی که در DDL کد شده‌اند (نه فقط قرارداد)
| قاعده | کجای schema |
|---|---|
| `held` ستون نیست — VIEW محاسباتی | `v_lot_availability` |
| موجودیِ منفی ممنوع | `CHECK (allocated+blocked <= on_hand)` |
| پول/متراژ integer (نه float) | `BIGINT`/`INT` (credit_limit, price, sqcm_per_box) |
| هر جدول دامنه‌ای `tenant_id` + composite FK | `FOREIGN KEY (tenant_id, x_id) → x(tenant_id, id)` |
| سازگاریِ lot↔variant در dispatch | `FK (tenant_id, lot_id, variant_id)` |
| backorder ⟺ lot NULL ∧ backorder_status | `CHECK` روی `sales_dispatch_item` |
| idempotency scope tenant + hash | `UNIQUE(tenant_id, idempotency_key)` + `idempotency_request_hash` |
| bootstrap هویتِ cross-tenant | تابع `user_contexts` (SECURITY DEFINER) |
| **موجودیِ در راه هرگز available نیست** | `incoming_stock` جدا از `inventory_balance`؛ رسیدن از مسیرِ لجر |
| رسیدنِ محموله برگشت‌پذیر نیست | `CHECK` روی `incoming_stock` (arrived ⟺ lot و زمان دارد) |
| کالا جایگزینِ خودش نمی‌شود | `CHECK (variant_id <> substitute_variant_id)` |
| یک نوبت برای هر نماینده روی هر کالا | `UNIQUE (agent_account_id, variant_id)` روی `waitlist_entry` |
| سقفِ تأییدِ خودکار: NULL=ارث/خاموش، ۰=هرگز | `auto_approve_limit` روی tenant و agent_account |
| چرا سفارش تأیید شد | `sales_request.approval_mode` + `auto_approve_limit_applied` (snapshot) |
| نشستِ باطل‌شده | `app_user.session_epoch` (شمارنده، نه timestamp — مرزِ ثانیه ندارد) |

## ایندکس‌های حیاتی
`idx_reservation_item_lot` و `idx_active_reservation_expiry` (partial، `WHERE status='active'`) و `idx_reservation_items_lot_qty` (covering) — همه برای کوئریِ `held`. بقیه در schema.sql بخش ۵.۱۰.

## Types / Conventions
- idها UUID (`gen_random_uuid()`). enum/statusها `TEXT + CHECK` (نه ENUM native — تغییرپذیرتر).
- پول = **ریال (IRR)** به BIGINT. متراژ = **cm²** به INT. زمان = **UTC** (`TIMESTAMPTZ`).

## Migration Strategy
`schema.sql` = نصب مرجع/تازه. **هرگز روی prodِ داده‌دار دوباره اجرا نشود.** تغییرات prod فقط با migrationهای forward نسخه‌دار در `db/migrations/` (هنوز ساخته نشده — چون prod نداریم؛ اولین migration همان schema.sql است). spec ۱۴.۹.

## Delete / Audit Policy
- `inventory_transaction`: append-only، هرگز UPDATE/DELETE (اصلاح = رکورد معکوس).
- `reservation`/`inventory_balance`: hard delete/manual update ممنوع؛ فقط از مسیر سرویس/تراکنش.
- `audit_log.old_value/new_value` برای اختلاف‌های مالی/موجودی.

## Backup / Restore
بک‌آپ روزانه‌ی رمزنگاری‌شده خارج از سرور اصلی + تست Restore ماهانه. RPO/RTO در spec ۸. جزئیات عملیاتی وقتی DEPLOYMENT_RUNBOOK ساخته شد.

## Open Questions
- natural key برای `inventory_lot` (برای import) به مصاحبه وابسته است — spec ۱۴.۵. تا آن موقع ایندکسش هاردکد نشده.
- `blocked_qty_boxes`: انواع (QC/آسیب/hold) در MVP تفکیک نمی‌شوند؛ فقط `reason_code` در لجر.

## Decision Log
- `sales_request_item.line_no` جای `UNIQUE(request_id, variant_id)` (چندشید) — spec ۱۴.۷.
- `partially_converted` حذف — spec ۱۴.۱.
