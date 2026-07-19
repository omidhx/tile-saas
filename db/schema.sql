-- =============================================================================
-- Tile SaaS — PostgreSQL schema (migration 0001, initial)
-- =============================================================================
-- مرجع: tile-saas-comprehensive-spec.md بخش ۵ (مدل داده) و بخش ۸ (امنیت).
-- این فایل قدمِ «DDL نهایی» از بخش ۱۳ است.
--
-- تصمیم‌های پیاده‌سازی (همه از spec، نه ابداعی):
--   • همه‌ی شناسه‌ها UUID (بخش «قراردادهای نام‌گذاری»).
--   • پول و متراژ BIGINT به کوچیک‌ترین واحد صحیح (قانون معماری #۷) — هیچ‌وقت float.
--     متراژ = سانتی‌متر مربع؛ پول = کوچیک‌ترین واحد پولی. تعداد کارتن = INTEGER.
--   • enum/status ها به‌صورت TEXT + CHECK(... IN ...) — چون وضعیت‌ها در طول زمان
--     عوض می‌شن و ALTER روی CHECK از ALTER TYPE ساده‌تره.
--   • «held» عمداً ستون نیست (قانون معماری #۱) — همیشه محاسباتی. پایینِ فایل یه
--     VIEW برای available هست. مسیر تراکنشیِ رزرو باید ردیف inventory_balance را
--     FOR UPDATE قفل کنه و held را داخل همون تراکنش با SUM حساب کنه (بخش ۶).
--   • هر جدول دامنه‌ای tenant_id دارد؛ روابط با composite FK
--     (tenant_id, x_id) → x(tenant_id, id) + RLS به‌عنوان لایه‌ی دوم (بخش ۸).
--   • پیش‌فرض‌های وابسته به مصاحبه (بخش ۷) اینجا با مقدار پیش‌فرضِ تحقیق‌شده اعمال
--     شدن ولی nullable/config-driven موندن تا جواب کارخونه فقط override کنه، نشکنه.
--
-- اجرا: psql "$DATABASE_URL" -f db/schema.sql
-- امنیت: اپ باید با یه نقشِ NON-superuser وصل شه و در ابتدای هر تراکنش
--        SET app.tenant_id = '<uuid>' بزنه، وگرنه RLS همه‌چی رو فیلتر می‌کنه.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- ۵.۱ هویت، تننت، حساب نمایندگی
-- ---------------------------------------------------------------------------

-- User سراسری است (نه tenant-scoped): یه شخص می‌تونه در چند تننت عضو باشه.
CREATE TABLE app_user (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         TEXT NOT NULL UNIQUE,
    email         TEXT,
    password_hash TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        TEXT NOT NULL,
    slug                        TEXT NOT NULL UNIQUE,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    default_reservation_ttl_hours INT NOT NULL DEFAULT 24,   -- بخش ۷.۸ پیش‌فرض ۲۴ ساعت
    track_shade_caliber         TEXT NOT NULL DEFAULT 'optional'
        CHECK (track_shade_caliber IN ('off','optional','required')),  -- بخش ۷.۱ پیش‌فرض optional
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_membership (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    user_id   UUID NOT NULL REFERENCES app_user(id),
    role      TEXT NOT NULL CHECK (role IN ('admin','staff','agent')),  -- staff/admin: تأیید+حواله؛ agent: رزرو
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (tenant_id, user_id)
);

CREATE TABLE agent_account (
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id),
    legal_name   TEXT NOT NULL,
    code         TEXT NOT NULL,
    credit_limit BIGINT,                     -- پول: کوچیک‌ترین واحد صحیح (قانون #۷)
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, code),                -- بخش ۵.۱۰
    UNIQUE (tenant_id, id)                   -- هدفِ composite FK
);

CREATE TABLE agent_account_user (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    agent_account_id UUID NOT NULL,
    user_id          UUID NOT NULL REFERENCES app_user(id),
    role             TEXT NOT NULL,
    UNIQUE (agent_account_id, user_id),
    FOREIGN KEY (tenant_id, agent_account_id) REFERENCES agent_account(tenant_id, id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_membership(tenant_id, user_id)  -- کاربر باید عضو همین tenant باشه
);

-- ---------------------------------------------------------------------------
-- ۵.۲ کاتالوگ
-- ---------------------------------------------------------------------------

CREATE TABLE brand (
    id        UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    name      TEXT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id)
);

CREATE TABLE product (
    id        UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    code      TEXT NOT NULL,
    name      TEXT NOT NULL,
    color     TEXT,
    glaze     TEXT,
    punch     TEXT,
    image_url TEXT,
    brand_id  UUID,     -- بخش ۷.۵: فعلاً product-level، nullable و آماده‌ی مهاجرت به Lot
    PRIMARY KEY (id),
    UNIQUE (tenant_id, code),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id)
);

CREATE TABLE product_variant (
    id              UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenant(id),
    product_id      UUID NOT NULL,
    grade           TEXT,                    -- درجه کیفی (یک/دو/سه/چهار) — بخش ۴
    sku             TEXT NOT NULL,
    boxes_per_pallet INT CHECK (boxes_per_pallet > 0),   -- بخش ۷.۶
    sqcm_per_box    INT CHECK (sqcm_per_box > 0),    -- مساحت هر کارتن به cm² (نمایش «معادل X متر») — nullable تا مصاحبه
    pieces_per_box  INT CHECK (pieces_per_box > 0),  -- برای price_basis=per_piece
    PRIMARY KEY (id),
    UNIQUE (tenant_id, sku),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, product_id) REFERENCES product(tenant_id, id)
);

CREATE TABLE warehouse (
    id        UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    name      TEXT NOT NULL,
    code      TEXT NOT NULL,
    type      TEXT NOT NULL CHECK (type IN ('main','regional','in_transit')),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, code),
    UNIQUE (tenant_id, id)
);

CREATE TABLE inventory_lot (
    id                      UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenant(id),
    variant_id              UUID NOT NULL,
    warehouse_id            UUID NOT NULL,
    batch_number            TEXT,
    shade_code              TEXT,            -- nullable — بخش ۷.۱، پشت track_shade_caliber
    caliber_code            TEXT,            -- nullable — بخش ۷.۱
    entry_date              DATE NOT NULL DEFAULT CURRENT_DATE,   -- FIFO بر این (بخش ۷.۴)
    bin_location            TEXT,            -- فقط پنل staff، هرگز UI نماینده (بخش ۱۰)
    boxes_per_pallet_override INT CHECK (boxes_per_pallet_override > 0),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, id, variant_id),   -- هدفِ composite FK از dispatch_item: سازگاریِ lot↔variant
    FOREIGN KEY (tenant_id, variant_id)   REFERENCES product_variant(tenant_id, id),
    FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouse(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- ۵.۳ موجودی — held عمداً ستون نیست (قانون معماری #۱)
-- ---------------------------------------------------------------------------

CREATE TABLE inventory_balance (
    id                 UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenant(id),
    lot_id             UUID NOT NULL,
    on_hand_qty_boxes  INT NOT NULL DEFAULT 0,
    allocated_qty_boxes INT NOT NULL DEFAULT 0,
    blocked_qty_boxes  INT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE (tenant_id, lot_id),   -- یک ردیف balance به‌ازای هر lot؛ همین ردیف تنها mutex آن lot است (بخش ۶)
    FOREIGN KEY (tenant_id, lot_id) REFERENCES inventory_lot(tenant_id, id),
    CHECK (on_hand_qty_boxes  >= 0),
    CHECK (allocated_qty_boxes >= 0),
    CHECK (blocked_qty_boxes  >= 0),
    CHECK (allocated_qty_boxes + blocked_qty_boxes <= on_hand_qty_boxes)
);

-- ---------------------------------------------------------------------------
-- ۵.۴ لجر append-only — اصلاح همیشه با رکورد معکوس، نه UPDATE/DELETE
-- ---------------------------------------------------------------------------

CREATE TABLE inventory_transaction (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenant(id),
    lot_id                UUID NOT NULL,
    transaction_type      TEXT NOT NULL,
    on_hand_delta_boxes   INT NOT NULL DEFAULT 0,
    allocated_delta_boxes INT NOT NULL DEFAULT 0,
    reference_type        TEXT,
    reference_id          UUID,
    actor_user_id         UUID REFERENCES app_user(id),
    reason_code           TEXT,
    note                  TEXT,
    occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    idempotency_key       TEXT UNIQUE,   -- NULL مجاز؛ Postgres چند NULL را یکتا نمی‌شمارد
    FOREIGN KEY (tenant_id, lot_id) REFERENCES inventory_lot(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- ۵.۵ رزرو — available >= requested همیشه، بدون استثنا (قانون #۲)
-- ---------------------------------------------------------------------------

CREATE TABLE reservation (
    id               UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    agent_account_id UUID NOT NULL,
    -- MVP: تبدیل all-or-nothing (active→converted). partially_converted حذف شد چون held فقط
    -- active را می‌شمارد؛ نگه‌داشتنش hold باقی‌مانده را زودهنگام آزاد نشان می‌داد (بخش ۶، v2).
    status           TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','converted','expired','cancelled')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at       TIMESTAMPTZ NOT NULL,
    idempotency_key          TEXT,
    idempotency_request_hash TEXT,   -- reuseِ کلید با payload متفاوت → ۴۰۹ (بخش ۶)
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, idempotency_key),   -- scope per-tenant، نه global
    FOREIGN KEY (tenant_id, agent_account_id) REFERENCES agent_account(tenant_id, id),
    CHECK (expires_at > created_at)
);

CREATE TABLE reservation_item (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id),
    reservation_id UUID NOT NULL,
    lot_id         UUID NOT NULL,
    quantity_boxes INT NOT NULL CHECK (quantity_boxes > 0),
    UNIQUE (reservation_id, lot_id),
    FOREIGN KEY (tenant_id, reservation_id) REFERENCES reservation(tenant_id, id),
    FOREIGN KEY (tenant_id, lot_id)         REFERENCES inventory_lot(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- ۵.۶ فروش و Dispatch — SalesRequest (تجاری) ≠ SalesDispatch (فیزیکی)
-- ---------------------------------------------------------------------------

CREATE TABLE sales_request (
    id               UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    agent_account_id UUID NOT NULL,
    status           TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','submitted','approved','rejected','cancelled','fulfilled')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, agent_account_id) REFERENCES agent_account(tenant_id, id)
);

CREATE TABLE sales_request_item (
    id                  UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES tenant(id),
    request_id          UUID NOT NULL,
    line_no             INT NOT NULL,   -- خط سفارش، نه variant: یک variant می‌تونه چند خط با شید متفاوت داشته باشه
    variant_id          UUID NOT NULL,
    requested_qty_boxes INT NOT NULL CHECK (requested_qty_boxes > 0),
    requested_shade_code   TEXT,   -- بخش ۷.۲: یک سفارش می‌تونه چند شید داشته باشه (اتاق‌های جدا)
    requested_caliber_code TEXT,
    unit_price_applied  BIGINT,          -- پول صحیح
    currency            TEXT,
    price_basis         TEXT CHECK (price_basis IN ('per_box','per_sqm','per_piece')),
    price_list_id       UUID,
    discount_amount     BIGINT DEFAULT 0,
    applied_price_source TEXT CHECK (applied_price_source IN ('base','list','override')),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, request_id, line_no),   -- به‌جای (request_id, variant_id) که چندشید را ممنوع می‌کرد
    FOREIGN KEY (tenant_id, request_id) REFERENCES sales_request(tenant_id, id),
    FOREIGN KEY (tenant_id, variant_id) REFERENCES product_variant(tenant_id, id)
);

CREATE TABLE sales_request_allocation (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenant(id),
    sales_request_item_id UUID NOT NULL,
    lot_id                UUID NOT NULL,
    allocated_qty_boxes   INT NOT NULL CHECK (allocated_qty_boxes > 0),
    FOREIGN KEY (tenant_id, sales_request_item_id) REFERENCES sales_request_item(tenant_id, id),
    FOREIGN KEY (tenant_id, lot_id)                REFERENCES inventory_lot(tenant_id, id)
);

CREATE TABLE sales_dispatch (
    id                UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenant(id),
    sales_request_id  UUID,            -- NULLABLE — مسیر backorder (بخش ۵.۶)
    agent_account_id  UUID NOT NULL,
    dispatch_code     TEXT NOT NULL,   -- auto-generated سمت اپ، UNIQUE per tenant
    reference_number  TEXT,            -- «دفتر ۱» — فقط اطلاعاتی، در uniqueness نیست
    customer_name     TEXT,            -- بخش ۷.۷: متن آزاد در MVP (نه Entity)
    destination       TEXT,
    status            TEXT NOT NULL DEFAULT 'registered'
        CHECK (status IN ('registered','ready_for_loading','loaded','delivered','cancelled')),
    created_by_user_id UUID NOT NULL REFERENCES app_user(id),   -- همیشه staff، هرگز نماینده
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, dispatch_code),
    FOREIGN KEY (tenant_id, agent_account_id) REFERENCES agent_account(tenant_id, id),
    FOREIGN KEY (tenant_id, sales_request_id) REFERENCES sales_request(tenant_id, id)
);

CREATE TABLE sales_dispatch_item (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    dispatch_id      UUID NOT NULL,
    lot_id           UUID,            -- NULLABLE — backorder بدون lot واقعی
    fulfillment_type TEXT NOT NULL CHECK (fulfillment_type IN ('in_stock','backorder')),
    backorder_status TEXT CHECK (backorder_status IN ('pending_production','ready','fulfilled','cancelled')),
    variant_id       UUID NOT NULL,
    quantity_boxes   INT NOT NULL CHECK (quantity_boxes > 0),
    warehouse_id     UUID,
    bin_location     TEXT,
    -- in_stock: lot لازم، backorder_status ممنوع. backorder: lot ممنوع، backorder_status لازم (بخش ۵.۶)
    CHECK ((fulfillment_type = 'in_stock'  AND lot_id IS NOT NULL AND backorder_status IS NULL)
        OR (fulfillment_type = 'backorder' AND lot_id IS NULL     AND backorder_status IS NOT NULL)),
    FOREIGN KEY (tenant_id, dispatch_id)  REFERENCES sales_dispatch(tenant_id, id),
    FOREIGN KEY (tenant_id, variant_id)   REFERENCES product_variant(tenant_id, id),
    -- composite (tenant_id, lot_id, variant_id): تضمین می‌کنه lotِ انتخاب‌شده واقعاً همین variant است.
    -- lot_id/warehouse_id nullable: MATCH SIMPLE یعنی وقتی NULL‌اند FK چک نمی‌شه (backorder)
    FOREIGN KEY (tenant_id, lot_id, variant_id) REFERENCES inventory_lot(tenant_id, id, variant_id),
    FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouse(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- ۵.۷ قیمت‌گذاری
-- ---------------------------------------------------------------------------

CREATE TABLE price_list (
    id        UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    name      TEXT NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id)
);

CREATE TABLE price_list_item (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id),
    price_list_id UUID NOT NULL,
    variant_id    UUID NOT NULL,
    price         BIGINT NOT NULL,     -- پول صحیح
    UNIQUE (price_list_id, variant_id),
    FOREIGN KEY (tenant_id, price_list_id) REFERENCES price_list(tenant_id, id),
    FOREIGN KEY (tenant_id, variant_id)    REFERENCES product_variant(tenant_id, id)
);

CREATE TABLE agent_price_override (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    agent_account_id UUID NOT NULL,
    variant_id       UUID NOT NULL,
    price            BIGINT NOT NULL,
    valid_from       DATE,
    valid_to         DATE,
    FOREIGN KEY (tenant_id, agent_account_id) REFERENCES agent_account(tenant_id, id),
    FOREIGN KEY (tenant_id, variant_id)       REFERENCES product_variant(tenant_id, id),
    CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

-- ---------------------------------------------------------------------------
-- ۵.۸ Import — پیش‌فرض snapshot (بخش ۷.۳)
-- ---------------------------------------------------------------------------

CREATE TABLE import_template (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id),
    column_mapping JSONB NOT NULL,
    version        INT NOT NULL DEFAULT 1
);

CREATE TABLE import_batch (
    id               UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    uploader_user_id UUID NOT NULL REFERENCES app_user(id),
    filename         TEXT NOT NULL,
    import_mode      TEXT NOT NULL DEFAULT 'snapshot'
        CHECK (import_mode IN ('snapshot','delta')),   -- بخش ۷.۳ پیش‌فرض snapshot
    checksum         TEXT,
    idempotency_key  TEXT,
    scope_type       TEXT NOT NULL DEFAULT 'tenant'
        CHECK (scope_type IN ('tenant','warehouse','brand')),   -- دامنه‌ی اسنپ‌شات (بخش ۷.۳): absent=صفر فقط داخل همین scope
    scope_warehouse_id UUID,
    scope_brand_id     UUID,
    effective_at     TIMESTAMPTZ,
    committed_at     TIMESTAMPTZ,
    status           TEXT NOT NULL DEFAULT 'pending',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, idempotency_key),   -- scope per-tenant
    FOREIGN KEY (tenant_id, scope_warehouse_id) REFERENCES warehouse(tenant_id, id),
    FOREIGN KEY (tenant_id, scope_brand_id)     REFERENCES brand(tenant_id, id)
);

CREATE TABLE import_row (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenant(id),
    batch_id              UUID NOT NULL,
    row_number            INT NOT NULL,
    raw_data              JSONB,
    normalized_data       JSONB,
    validation_errors     JSONB,
    processing_status     TEXT NOT NULL DEFAULT 'pending',
    matched_variant_id    UUID,
    matched_lot_id        UUID,
    resulting_transaction_id UUID,
    FOREIGN KEY (tenant_id, batch_id) REFERENCES import_batch(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- ۵.۹ اعلان و Audit — پیامک، نه تلگرام (بخش ۵.۹)
-- ---------------------------------------------------------------------------

CREATE TABLE notification_outbox (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id),
    channel       TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms')),
    recipient     TEXT NOT NULL,
    payload       JSONB NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
    attempt_count INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at       TIMESTAMPTZ
);

CREATE TABLE stock_alert (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    agent_account_id UUID NOT NULL,
    variant_id       UUID NOT NULL,
    UNIQUE (agent_account_id, variant_id),
    FOREIGN KEY (tenant_id, agent_account_id) REFERENCES agent_account(tenant_id, id),
    FOREIGN KEY (tenant_id, variant_id)       REFERENCES product_variant(tenant_id, id)
);

CREATE TABLE audit_log (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id),
    actor_user_id UUID REFERENCES app_user(id),
    action        TEXT NOT NULL,
    entity        TEXT NOT NULL,
    entity_id     UUID,
    old_value     JSONB,   -- برای اختلاف مالی/موجودی: «قبل از این تراکنش چند بود؟»
    new_value     JSONB,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- ۵.۱۰ ایندکس‌ها
-- ---------------------------------------------------------------------------

CREATE INDEX idx_lot_variant_wh        ON inventory_lot (tenant_id, variant_id, warehouse_id);
CREATE INDEX idx_reservation_status    ON reservation (tenant_id, status, expires_at);
CREATE INDEX idx_reservation_item_lot  ON reservation_item (lot_id);   -- حیاتی برای کوئری held
CREATE INDEX idx_sales_request_list    ON sales_request (tenant_id, status, created_at DESC);
CREATE INDEX idx_sales_dispatch_list   ON sales_dispatch (tenant_id, status, created_at DESC);
CREATE INDEX idx_dispatch_item_dispatch ON sales_dispatch_item (dispatch_id);
CREATE INDEX idx_txn_lot               ON inventory_transaction (lot_id, created_at DESC);
CREATE INDEX idx_import_row_batch      ON import_row (batch_id, processing_status);

-- partial: فقط رزروهای فعال برای worker انقضا
CREATE INDEX idx_active_reservation_expiry ON reservation (expires_at) WHERE status = 'active';
-- covering: کوئری held بدون رفتن به heap
CREATE INDEX idx_reservation_items_lot_qty ON reservation_item (lot_id, quantity_boxes) INCLUDE (reservation_id);

-- ---------------------------------------------------------------------------
-- held و available — قانون معماری #۱ به‌شکل کد
-- ---------------------------------------------------------------------------
-- held هیچ‌وقت ذخیره نمی‌شه؛ همیشه از رزروهای active و منقضی‌نشده SUM می‌شه.
-- این VIEW برای خواندن/نمایش است. مسیرِ تراکنشیِ رزرو نباید صرفاً به این VIEW
-- تکیه کنه — باید ردیف inventory_balance را FOR UPDATE قفل و held را داخل همان
-- تراکنش دوباره حساب کند (بخش ۶)، چون available در لحظه‌ی قفل معتبر است نه قبلش.

CREATE VIEW v_lot_availability AS
SELECT
    b.tenant_id,
    b.lot_id,
    b.on_hand_qty_boxes,
    b.allocated_qty_boxes,
    b.blocked_qty_boxes,
    COALESCE((
        SELECT SUM(ri.quantity_boxes)
        FROM reservation_item ri
        JOIN reservation r ON r.id = ri.reservation_id
        WHERE ri.lot_id = b.lot_id
          AND r.status = 'active'
          AND r.expires_at > now()
    ), 0)::int AS held_qty_boxes,     -- ::int چون SUM بیگ‌اینت می‌ده و رشته برمی‌گرده
    (b.on_hand_qty_boxes
      - COALESCE((
            SELECT SUM(ri.quantity_boxes)
            FROM reservation_item ri
            JOIN reservation r ON r.id = ri.reservation_id
            WHERE ri.lot_id = b.lot_id
              AND r.status = 'active'
              AND r.expires_at > now()
        ), 0)
      - b.allocated_qty_boxes
      - b.blocked_qty_boxes)::int AS available_qty_boxes
FROM inventory_balance b;

-- ---------------------------------------------------------------------------
-- bootstrap هویت: «کاربر عضو کدوم tenant/نمایندگی‌هاست؟»
-- ---------------------------------------------------------------------------
-- این کوئری ذاتاً cross-tenant است (قبل از انتخاب tenant اجرا می‌شه)، پس با RLSِ
-- تک‌تننتی گیر می‌کنه. SECURITY DEFINER از RLS عبور می‌کنه ولی امنه چون فقط برای
-- p_user_id داده‌شده ردیف می‌ده — اپ همیشه userIdِ احرازشده (از JWT) رو پاس می‌ده،
-- هرگز ورودی کلاینت. این تنها راهِ درستِ عبور از RLS برای این نوع bootstrap است.
-- LEFT JOIN عمدی: کاربرِ staff به هیچ agent_account وصل نیست، ولی بازم باید context
-- (tenant + نقش) بگیره — وگرنه پنل staff هیچ tenantId نداره و UI قفل می‌شه.
-- role برگردونده می‌شه تا UI بدونه کاربر نماینده‌ست یا پشتیبان.
CREATE FUNCTION user_contexts(p_user_id UUID)
RETURNS TABLE (tenant_id UUID, tenant_name TEXT, agent_account_id UUID, agent_legal_name TEXT, role TEXT)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT t.id, t.name, aa.id, aa.legal_name, tm.role
    FROM tenant_membership tm
    JOIN tenant t              ON t.id = tm.tenant_id AND t.is_active
    LEFT JOIN agent_account_user aau ON aau.user_id = tm.user_id AND aau.tenant_id = tm.tenant_id
    LEFT JOIN agent_account aa ON aa.id = aau.agent_account_id AND aa.is_active
    WHERE tm.user_id = p_user_id AND tm.is_active
$$;
REVOKE EXECUTE ON FUNCTION user_contexts(UUID) FROM PUBLIC;
-- در دیپلوی: GRANT EXECUTE ON FUNCTION user_contexts(UUID) TO <نقشِ اپ>;

-- ---------------------------------------------------------------------------
-- ۸. RLS — لایه‌ی دوم دفاعی، روی هر جدولِ دارای tenant_id
-- ---------------------------------------------------------------------------
-- app.tenant_id باید در ابتدای هر تراکنش SET شه. اپ با نقشِ non-superuser وصل شه
-- (superuser از RLS معاف است). این کنار composite FK کار می‌کنه، نه به‌جای آن.

DO $$
DECLARE t TEXT;
BEGIN
    FOR t IN
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relkind = 'r'
          AND n.nspname = 'public'
          AND a.attname = 'tenant_id'
          AND a.attnum > 0
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format($f$
            CREATE POLICY tenant_isolation ON %I
            USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
            WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
        $f$, t);
    END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- چیزهایی که عمداً اینجا نیست (نه فراموشی):
--   • قفل ORDER BY lot_id و چک available>=requested → منطق اپ در تراکنش (بخش ۶)،
--     در DDL بیان‌شدنی نیست.
--   • تولید dispatch_code و idempotency_key → سمت اپ.
--   • migrationهای بعدی (تخفیف حجمی، Customer entity...) → فایل‌های جدا در db/.
-- =============================================================================
