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
   ├─ price_list ──< price_list_item ;  agent_price_override
   ├─ import_batch (scope: tenant/warehouse/brand) ──< import_row
   └─ notification_outbox ; stock_alert ; audit_log (old/new JSONB)
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
