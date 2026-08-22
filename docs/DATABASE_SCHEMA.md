# DATABASE_SCHEMA

> **منبع حقیقت = [../db/schema.sql](../db/schema.sql).** این سند نقشه و قواعد را می‌دهد؛ ستون‌به‌ستون را کپی نمی‌کند (کپی سریع دروغ می‌شود). برای تعریف دقیق هر جدول، همان فایل را بخوان. تصمیم‌ها و استدلال: spec بخش ۵ و ۱۴.

## نقشه‌ی جدول‌ها (ERD خلاصه)
```
app_user (سراسری، full_name nullable، is_platform_admin) ──< tenant_membership (can_manage_access, allowed_pages) >── tenant
                          │                   │
tenant ──< agent_account (assigned_staff_user_id → app_user) ──< agent_account_user (FK به membership)
   │
   ├─ brand ──< product ──< product_variant ──< inventory_lot ──1:1─ inventory_balance
   │              └──< product_image (گالری؛ اصلی = کمترین sort_order، کَش در product.image_url) (v2)
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

### جداولِ زیرساختی (نه tenant-scoped، نه RLS)

این جداول در `schema.sql` و `db/migrations/` همگن‌اند:

- `_migrations` (migration 0002) — ردیابیِ migrationهای اجرا شده با checksum. فقط نقشِ `app_user` حقِ SELECT دارد.
- `_rate_limit_hits` (migration 0003) — شمارنده‌ی rate limit برای multi-instance (`RATE_LIMIT_BACKEND=postgres`).

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
| bootstrap هویتِ cross-tenant | تابع `user_contexts` (SECURITY DEFINER + `SET search_path`) |
| **موجودیِ در راه هرگز available نیست** | `incoming_stock` جدا از `inventory_balance`؛ رسیدن از مسیرِ لجر |
| رسیدنِ محموله برگشت‌پذیر نیست | `CHECK` روی `incoming_stock` (arrived ⟺ lot و زمان دارد) |
| کالا جایگزینِ خودش نمی‌شود | `CHECK (variant_id <> substitute_variant_id)` |
| یک نوبت برای هر نماینده روی هر کالا | `UNIQUE (agent_account_id, variant_id)` روی `waitlist_entry` |
| سقفِ تأییدِ خودکار: NULL=ارث/خاموش، ۰=هرگز | `auto_approve_limit` روی tenant و agent_account |
| چرا سفارش تأیید شد | `sales_request.approval_mode` + `auto_approve_limit_applied` (snapshot) |
| نشستِ باطل‌شده | `app_user.session_epoch` (شمارنده، نه timestamp — مرزِ ثانیه ندارد) |
| دسترسیِ ریزدانه‌ی صفحه برای staff | `tenant_membership.allowed_pages` (TEXT[]، خالی=کامل) + `can_manage_access` (فقط برای role='admin' معنا دارد) |
| پشتیبانِ ثابتِ نمایندگی (بدونِ composite FK چون app_user سراسری است) | `agent_account.assigned_staff_user_id UUID REFERENCES app_user(id)`؛ عضویتِ tenant در لایه‌ی app چک می‌شود (`isActiveStaffMember`) |
| موجودیِ اولیه از مسیرِ لجر می‌آید، نه UPDATE مستقیم | `inventory_transaction.transaction_type='initial_stock'` هنگامِ ساختِ محصول با انبار+تعداد |
| روزِ صفرِ tenantِ تازه بدونِ SQL دستی | `app_user.is_platform_admin` (بالاتر از سطحِ tenant) + `db/platform.ts::createTenant` (یک تراکنش: tenant + اولین admin) |
| **SECURITY DEFINER از search_path injection محافظت** (Phase 10-post) | هر چهار تابع با `SET search_path = public, pg_temp` |
| **Migration با checksum validation** (Phase 10-post) | جدول `_migrations` (در `db/migrations/0002`) |
| **Rate limiter multi-instance** (Phase 10-post) | جدول `_rate_limit_hits` (در `db/migrations/0003`) — نه tenant-scoped |

## ایندکس‌های حیاتی
`idx_reservation_item_lot` و `idx_active_reservation_expiry` (partial، `WHERE status='active'`) و `idx_reservation_items_lot_qty` (covering) — همه برای کوئریِ `held`. بقیه در schema.sql بخش ۵.۱۰.

## Types / Conventions
- idها UUID (`gen_random_uuid()`). enum/statusها `TEXT + CHECK` (نه ENUM native — تغییرپذیرتر).
- پول = **ریال (IRR)** به BIGINT. متراژ = **cm²** به INT. زمان = **UTC** (`TIMESTAMPTZ`).

## Migration Strategy
`schema.sql` = نصب مرجع/تازه. **هرگز روی prodِ داده‌دار دوباره اجرا نشود.** تغییرات prod فقط با migrationهای forward-only در `db/migrations/` (Phase 10-post):

```bash
# اجرای idempotentِ همه‌ی migrationهای اجرا‌نشده:
node --env-file=web/.env --import tsx db/migrations/apply.ts

# یا:
cd web && npm run migrate
```

`apply.ts` ردِ اجرا را در جدول `_migrations` نگه می‌دارد (با checksum)؛ در صورت شکستِ mid-way،
تراکنش rollback می‌شود. spec ۱۴.۹.

### Migrationهای موجود
| # | نام | توضیح |
|---|---|---|
| 0001 | (در ریشه) `schema.sql` | نصبِ اولیه — در migration system نیست |
| 0002 | `migrations_table` | جدول `_migrations` برای ردیابی |
| 0003 | `rate_limit_table` | جدول `_rate_limit_hits` برای multi-instance rate limiter |

### قواعدِ migration
۱. نام‌گذاری: `NNNN_short_description.sql` (۴ رقمی).
۲. forward-only — migrationهای reverse نداریم.
۳. هر migration با `BEGIN;`/`COMMIT;` (مگر عملیاتِ خارج از tx مثل `CREATE INDEX CONCURRENTLY`).
۴. یک migration فقط یک کار می‌کند.
۵. هرگز `DROP TABLE` روی prod بدونِ تأیید و بکاپ.

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
