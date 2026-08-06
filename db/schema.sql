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
    -- v5: نام و نام‌خانوادگی — تا اینجا فقط شماره/ایمیل بود که برای «این پشتیبانِ
    -- ثابتِ نمایندگیِ توست» نمایش‌پذیر نیست. nullable: کاربرهای قدیمی نام ندارند،
    -- UI باید با شماره fallback کند (همان قاعده‌ی audit_log.actor_phone).
    full_name     TEXT,
    -- v3: ایمیل و بله هم راهِ ورود/بازیابی‌اند، نه فقط موبایل — تا قطعیِ یک کانال
    -- کاربر را کاملاً بیرون از سامانه نگذارد. هر دو nullable (اول فقط موبایل لازم
    -- است) ولی وقتی پر باشند باید یکتا بمانند، وگرنه لاگین با ایمیل مبهم می‌شود.
    email         TEXT,
    -- chat_id عددیِ ربات بله، بعد از اتصالِ حساب (فلوی اتصال بعداً، نیازمندِ webhook
    -- عمومی است — همان محدودیتِ SMSِ production، پس فعلاً ستون هست، فلو نیست).
    bale_chat_id  TEXT,
    password_hash TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    -- نسخه‌ی نشست. JWT همین عدد را حمل می‌کند و فقط وقتی معتبر است که **برابر**
    -- باشد؛ هر تغییر/بازیابیِ رمز یا «خروج از همه» یکی به آن اضافه می‌کند.
    -- بدون این، تغییرِ رمز امنیتِ نمایشی بود: JWT امضاشده تا ۷ روز معتبر می‌ماند و
    -- نشستِ دزدیده‌شده روی دستگاهِ دیگر زنده می‌ماند.
    --
    -- چرا شمارنده و نه timestamp: `iat` در JWT **ثانیه‌ای** است، پس مقایسه با زمان
    -- یک مرز دارد — توکنی که در همان ثانیه‌ی باطل‌سازی صادر شده بود از شرطِ
    -- `iat < valid_from` رد می‌شد و **برای همیشه** زنده می‌ماند. مقایسه‌ی تساویِ
    -- یک عدد هیچ granularity ندارد و این مرز را کاملاً حذف می‌کند.
    session_epoch INT NOT NULL DEFAULT 0,
    -- v9: مدیرِ پلتفرم — بالاتر از سطحِ tenant، حقِ ساختِ کارخانه‌ی تازه (+ اولین
    -- مدیرش) را دارد. بدونِ این، روزِ صفرِ هر مشتریِ تازه فقط با SQL دستی ممکن بود
    -- (هیچ ادمینی هنوز نبود که وارد شود و از UI تیم/نمایندگی استفاده کند) —
    -- دقیقاً همان کارِ مهندس-به‌ازای-هر-مشتری که با ایده‌ی SaaS در تضاد است.
    is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- یکتاییِ partial: NULL نامحدود مجاز است (اکثرِ کاربرها ایمیل ندارند)، فقط
-- مقدارهای واقعی نباید تکرار شوند.
CREATE UNIQUE INDEX idx_app_user_email ON app_user (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX idx_app_user_bale ON app_user (bale_chat_id) WHERE bale_chat_id IS NOT NULL;

-- کدِ یک‌بارمصرفِ بازیابی رمز (SMS). خودِ کد ذخیره نمی‌شود — hash می‌شود، چون
-- یک اعتبارنامه است: هرکس به DB خواندنی دسترسی پیدا کند نباید بتواند رمز عوض کند.
CREATE TABLE password_reset (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    code_hash     TEXT NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    used_at       TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (expires_at > created_at)
);
CREATE INDEX idx_password_reset_user ON password_reset (user_id, created_at DESC);

CREATE TABLE tenant (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        TEXT NOT NULL,
    slug                        TEXT NOT NULL UNIQUE,
    is_active                   BOOLEAN NOT NULL DEFAULT TRUE,
    default_reservation_ttl_hours INT NOT NULL DEFAULT 24,   -- بخش ۷.۸ پیش‌فرض ۲۴ ساعت
    -- v9 تنظیماتِ کارخانه: لوگو برای کاتالوگِ عمومیِ مشتری (spec ۷.۸، «لوگو»).
    -- NULL یعنی هنوز آپلود نشده — همان‌جا فقط نامِ کارخانه نشان داده می‌شود.
    logo_url                    TEXT,
    -- v10 «پنلِ پیامکیِ خودِ کارخانه»: هر tenant پروایدرِ پیامکِ خودش را (که خریده) از
    -- UI انتخاب و کانفیگ می‌کند، دیگر SMS_PROVIDER سراسری نیست. رازها (apiKey/password)
    -- با secretBox.ts رمزنگاری‌شده ذخیره می‌شوند، هرگز خام. NULL/enabled=false یعنی
    -- خاموش — worker حتی یک HTTP call هم برای این tenant نمی‌زند (سبک و بی‌مزاحمت).
    sms_config                   JSONB,
    -- v11 «واحدِ نمایشِ مبلغ»: فقط لایه‌ی UI را عوض می‌کند — ذخیره‌سازی/محاسبات همیشه
    -- ریال می‌مانند (spec ۱۴.۸: پول هیچ‌وقت float نیست). toman یعنی هرجا مبلغ نشان
    -- داده می‌شود (پنلِ پشتیبان، نماینده، کاتالوگِ عمومی، اکسل) روی ۱۰ تقسیم می‌شود.
    currency_unit                TEXT NOT NULL DEFAULT 'rial'
        CHECK (currency_unit IN ('rial','toman')),
    track_shade_caliber         TEXT NOT NULL DEFAULT 'optional'
        CHECK (track_shade_caliber IN ('off','optional','required')),  -- بخش ۷.۱ پیش‌فرض optional
    -- v2 «تأیید هیبریدی» (بخش ۹): سقفِ ارزشِ سفارش که زیرش رزرو خودکار تأیید می‌شود.
    -- NULL = خاموش، یعنی همه‌ی رزروها تأییدِ دستی می‌خواهند. پیش‌فرض عمداً خاموش است:
    -- فیچری که پول را بدونِ نگاهِ انسان متعهد می‌کند نباید با نصبِ ساده روشن شود.
    auto_approve_limit          BIGINT CHECK (auto_approve_limit >= 0),
    -- v3 «سقفِ اشتراک»: قلاب برای پلن/billingِ آینده — NULL همان معنیِ همیشگی را
    -- دارد (نامحدود)، پس تننت‌های فعلی تغییری نمی‌بینند. وقتی صورتحساب واقعی
    -- اضافه شد، فقط همین دو عدد را ست می‌کند؛ create-flowها همین الان گارد را
    -- رعایت می‌کنند (db/team.ts، db/agents.ts).
    max_staff                   INT CHECK (max_staff >= 0),
    max_agents                  INT CHECK (max_agents >= 0),
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tenant_membership (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenant(id),
    user_id   UUID NOT NULL REFERENCES app_user(id),
    role      TEXT NOT NULL CHECK (role IN ('admin','staff','agent')),  -- staff/admin: تأیید+حواله؛ agent: رزرو
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- v4 «مدیرِ دسترسی»: تنِ نقشِ admin. صرفاً admin‌بودن دیگر کافی نیست برای
    -- مدیریتِ تیم/دسترسیِ بقیه — این فلگِ جداست، باید صریحاً داده شود (پیش‌فرض
    -- false). فقط برای role='admin' معنا دارد؛ روی staff/agent نادیده گرفته می‌شود.
    can_manage_access BOOLEAN NOT NULL DEFAULT FALSE,
    -- v4 «دسترسیِ ریزدانه»: فقط برای role='staff' معنا دارد. آرایه‌ی خالی یعنی
    -- دسترسیِ کامل (رفتارِ پیش‌فرض/قبلی، برای سازگاری با کاربرهای موجود) —
    -- وقتی مدیر صریحاً زیرمجموعه‌ای انتخاب کند، فقط همان‌ها مجازند.
    allowed_pages TEXT[] NOT NULL DEFAULT '{}',
    UNIQUE (tenant_id, user_id)
);

CREATE TABLE agent_account (
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id),
    legal_name   TEXT NOT NULL,
    code         TEXT NOT NULL,
    credit_limit BIGINT,                     -- پول: کوچیک‌ترین واحد صحیح (قانون #۷)
    price_list_id UUID,                      -- v2: لیست قیمتِ این نماینده (FK پایین‌تر، بعد از price_list)
    -- v2 «تأیید هیبریدی»: سقفِ اختصاصیِ این نماینده.
    --   NULL = ارث از tenant.auto_approve_limit
    --   0    = هرگز خودکار (نماینده‌ی تازه/بدهکار) — چون ۰ کوچک‌تر از هر سفارشی است،
    --          همین یک عدد جای یک ستونِ بولیِ جداگانه را می‌گیرد.
    auto_approve_limit BIGINT CHECK (auto_approve_limit >= 0),
    -- v5 «پشتیبانِ ثابت»: کارخانه پورسانتِ هر نماینده را به یک پشتیبانِ مشخص
    -- می‌دهد؛ نماینده باید بداند سفارشش دستِ کیست، حتی وقتی خودکار تأیید شده
    -- (هیچ actor انسانی در کار نبوده). فقط admin از /staff/agents تعیینش می‌کند
    -- (نه هر staff‌ای) — همانی که پورسانت را حساب می‌کند باید کنترلش کند.
    -- REFERENCES app_user(id) نه composite: app_user سراسری است، بی tenant_id.
    -- اینکه این کاربر واقعاً عضوِ فعالِ staff/adminِ همین tenant باشد را
    -- db/agents.ts در لحظه‌ی ست‌کردن چک می‌کند (schema به‌تنهایی نمی‌تواند).
    assigned_staff_user_id UUID REFERENCES app_user(id),
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
    glaze     TEXT,   -- لعاب: مات/ترانس
    punch     TEXT,   -- پانچ: تخت/رستیک-…
    body      TEXT,   -- بدنه: سفید/قرمز (v2، مثل کاتالوگِ صنعتی)
    -- فیلدهای اختیاریِ «اطلاعاتِ بیشتر» (v2): در فرمِ مدیریت محصول در بخشِ جمع‌شو
    size        TEXT,   -- ابعاد: ۶۰×۶۰
    thickness   TEXT,   -- ضخامت: ۹ میلی‌متر
    usage_area  TEXT,   -- کاربری: کف/دیوار/نما ("usage" کلمه‌ی حساسِ SQL نیست ولی صریح‌تر است)
    description TEXT,    -- توضیحاتِ متنِ آزاد
    image_url TEXT,     -- کَشِ عکسِ اصلی (= اولین product_image)؛ برای تامنیل در همه‌ی خواندن‌ها
    brand_id  UUID,     -- بخش ۷.۵: فعلاً product-level، nullable و آماده‌ی مهاجرت به Lot
    PRIMARY KEY (id),
    UNIQUE (tenant_id, code),
    UNIQUE (tenant_id, id),
    FOREIGN KEY (tenant_id, brand_id) REFERENCES brand(tenant_id, id)
);

-- گالریِ تصاویرِ محصول (v2). عکسِ اصلی = کمترین sort_order؛ همان در product.image_url
-- کَش می‌شود تا تامنیل همه‌جا بدونِ join خوانده شود. ترتیب = sort_order.
CREATE TABLE product_image (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    product_id UUID NOT NULL,
    url        TEXT NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    FOREIGN KEY (tenant_id, product_id) REFERENCES product (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_product_image ON product_image (tenant_id, product_id, sort_order);

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
    -- v2 «تأیید هیبریدی»: چرا این سفارش تأیید شد. اولین سؤالِ کارخانه وقتی سفارشی
    -- بدونِ دخالتِ او تأیید شده «چه کسی این را تأیید کرد؟» است — بدونِ این ستون،
    -- پاسخ فقط یک actor_user_id خالی در لجر بود.
    approval_mode    TEXT NOT NULL DEFAULT 'manual' CHECK (approval_mode IN ('manual','auto')),
    -- سقفی که در لحظه‌ی تأییدِ خودکار اعمال شد (snapshot، مثل قیمت). اگر بعداً سقف
    -- عوض شود، نباید تاریخچه بازنویسی شود.
    auto_approve_limit_applied BIGINT,
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

-- v2 «Customer به‌عنوان Entity کامل با تاریخچه» (بخش ۹، مشروط به بخش ۷.۷).
--
-- در MVP عمداً متن آزاد بود؛ spec ارتقا را مشروط کرده بود به «اگر گزارشِ
-- پرخریدترین مشتری لازم شد». همان گزارش دلیلِ وجودِ این جدول است.
--
-- مشتریِ نهاییِ نماینده است، نه مشتریِ کارخانه: `agent_account_id` می‌گوید مالِ
-- کدام نمایندگی است، تا نماینده‌ها فهرستِ مشتریانِ هم را نبینند.
CREATE TABLE customer (
    id               UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    agent_account_id UUID,            -- nullable: مشتریِ مستقیمِ کارخانه هم ممکن است
    name             TEXT NOT NULL,
    phone            TEXT,
    note             TEXT,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),          -- هدفِ composite FK
    FOREIGN KEY (tenant_id, agent_account_id) REFERENCES agent_account(tenant_id, id)
);
CREATE INDEX idx_customer_agent ON customer (tenant_id, agent_account_id, name);

CREATE TABLE sales_dispatch (
    id                UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES tenant(id),
    sales_request_id  UUID,            -- NULLABLE — مسیر backorder (بخش ۵.۶)
    agent_account_id  UUID NOT NULL,
    dispatch_code     TEXT NOT NULL,   -- auto-generated سمت اپ، UNIQUE per tenant
    -- v2 چندانباره: هر حواله در **یک** انبار بار می‌زند (یک کامیون، یک اسکله).
    -- سفارشی که از دو انبار تأمین شود به دو حواله تقسیم می‌شود، نه یک حواله‌ی
    -- دوانباره که انباردار نتواند کاملش کند.
    -- NULLABLE چون حواله‌ی backorder هنوز lot ندارد، پس انبارش هم معلوم نیست.
    warehouse_id      UUID,
    reference_number  TEXT,            -- «دفتر ۱» — فقط اطلاعاتی، در uniqueness نیست
    -- v2: مشتری Entity شد، ولی این ستون **می‌ماند** و نقشش عوض شد:
    -- حالا snapshotِ نامِ مشتری در لحظه‌ی حواله است. اگر بعداً نامِ مشتری اصلاح شود،
    -- حواله‌ی صادرشده نباید بازنویسی شود — همان قاعده‌ی snapshotِ قیمت.
    -- برای حواله‌های قدیمی (قبل از Entity) این تنها چیزی است که داریم.
    customer_name     TEXT,
    customer_id       UUID,            -- v2، nullable: حواله‌ی بدونِ مشتریِ ثبت‌شده مجاز است
    destination       TEXT,
    status            TEXT NOT NULL DEFAULT 'registered'
        CHECK (status IN ('registered','ready_for_loading','loaded','delivered','cancelled')),
    created_by_user_id UUID NOT NULL REFERENCES app_user(id),   -- همیشه staff، هرگز نماینده
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, dispatch_code),
    FOREIGN KEY (tenant_id, agent_account_id) REFERENCES agent_account(tenant_id, id),
    FOREIGN KEY (tenant_id, sales_request_id) REFERENCES sales_request(tenant_id, id),
    FOREIGN KEY (tenant_id, warehouse_id)     REFERENCES warehouse(tenant_id, id),
    FOREIGN KEY (tenant_id, customer_id)      REFERENCES customer(tenant_id, id)
);
CREATE INDEX idx_dispatch_customer ON sales_dispatch (tenant_id, customer_id);

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

-- FK اینجا (نه بالا) چون price_list بعد از agent_account تعریف می‌شود
ALTER TABLE agent_account
  ADD CONSTRAINT agent_account_price_list_fk
  FOREIGN KEY (tenant_id, price_list_id) REFERENCES price_list(tenant_id, id);

-- v2: تخفیف حجمی. پله‌ای بر اساس تعداد کارتن.
-- درصدِ صحیح (نه اعشار) تا محاسبه‌ی پول هیچ‌جا float نشود (قانون معماری #۷).
-- NULL یعنی «همه»: price_list_id NULL → روی همه‌ی لیست‌ها، variant_id NULL → روی همه‌ی کالاها.
CREATE TABLE volume_discount (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenant(id),
    price_list_id UUID,
    variant_id    UUID,
    min_qty_boxes INT NOT NULL CHECK (min_qty_boxes > 0),
    percent_off   INT NOT NULL CHECK (percent_off > 0 AND percent_off <= 100),
    FOREIGN KEY (tenant_id, price_list_id) REFERENCES price_list(tenant_id, id),
    FOREIGN KEY (tenant_id, variant_id)    REFERENCES product_variant(tenant_id, id),
    -- NULLS NOT DISTINCT: دو پله‌ی «همه‌ی کالاها با همین حداقل» نباید تکراری ثبت شوند
    UNIQUE NULLS NOT DISTINCT (tenant_id, price_list_id, variant_id, min_qty_boxes)
);
CREATE INDEX idx_volume_discount_lookup ON volume_discount (tenant_id, variant_id, min_qty_boxes DESC);

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
    -- v3 «چندکاناله»: پیامک تنها راه نبود — قطعیِ خطِ SMS یعنی کاربر هیچ کدی
    -- نمی‌گیرد. email/bale افزوده شدند تا همان کد به چند مسیر صف شود (بخش پایین).
    channel       TEXT NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms','email','bale')),
    recipient     TEXT NOT NULL,
    payload       JSONB NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
    attempt_count INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at       TIMESTAMPTZ
);

-- v2 «موجودی در راه / پیش‌فروش تولید» (بخش ۹) — فلوی کامل‌تر از فلگ ساده.
--
-- **این جدول هرگز وارد `available` نمی‌شود.** معادله‌ی
-- `available = on_hand − held − allocated − blocked` دست‌نخورده می‌ماند (spec ۱۹۸):
-- اگر موجودیِ نیامده را available حساب کنیم، نماینده روی کالایی سفارش می‌دهد که
-- وجود ندارد و اولین کسی که واقعاً بار می‌خواهد دستش خالی می‌ماند.
--
-- پس این «موجودیِ دوم» نیست، یک **تعهدِ زمان‌دار** است: چقدر، کجا، و کِی می‌رسد.
-- چیزی که در v1 کم بود همین «کِی» بود — backorder فقط می‌گفت «در انتظار تولید».
--
-- رسیدن (`arrived`) موجودی را از مسیرِ عادیِ لجر وارد می‌کند، نه با UPDATE مستقیم،
-- تا گزارشِ تطبیق تراز بماند.
CREATE TABLE incoming_stock (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id),
    variant_id     UUID NOT NULL,
    warehouse_id   UUID NOT NULL,          -- کجا قرار است بنشیند
    quantity_boxes INT  NOT NULL CHECK (quantity_boxes > 0),
    expected_at    DATE NOT NULL,          -- همان «کِی» که کم بود
    source         TEXT NOT NULL DEFAULT 'production'
        CHECK (source IN ('production','transfer','purchase')),
    status         TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned','confirmed','arrived','cancelled')),
    -- lotی که موقعِ رسیدن ساخته/به‌روز شد — رد پا برای اینکه دوباره وارد نشود
    arrived_lot_id UUID,
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    arrived_at     TIMESTAMPTZ,
    -- arrived حتماً lot دارد؛ بقیه‌ی وضعیت‌ها حتماً ندارند
    CHECK ((status = 'arrived' AND arrived_lot_id IS NOT NULL AND arrived_at IS NOT NULL)
        OR (status <> 'arrived' AND arrived_lot_id IS NULL AND arrived_at IS NULL)),
    FOREIGN KEY (tenant_id, variant_id)   REFERENCES product_variant(tenant_id, id),
    FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouse(tenant_id, id)
);
CREATE INDEX idx_incoming_lookup ON incoming_stock (tenant_id, variant_id, status, expected_at);

-- v2 «پیشنهاد خودکار کالای جایگزین» (بخش ۹).
--
-- چرا جدولِ صریح و نه تطبیقِ خودکار بر اساس صفت: **هیچ فیلدِ ساختاریافته‌ای برای
-- ابعاد نداریم** — اندازه فقط داخلِ نام/کد است، و `sqcm_per_box` مساحتِ کارتن
-- است نه ابعاد (۶۰×۶۰ و ۳۰×۱۲۰ می‌توانند مساحتِ یکسان داشته باشند و هرگز
-- جایگزینِ هم نیستند). `color`/`glaze`/`grade` هم nullable‌اند و import پرشان
-- نمی‌کند. حدسِ ماشینی اینجا یعنی پیشنهادِ اشتباه به نماینده — بدتر از پیشنهاد ندادن.
--
-- جهت‌دار است، نه متقارن: «اگر گرانیتِ گران نبود، ارزان را پیشنهاد بده» لزوماً
-- برعکسش درست نیست.
CREATE TABLE product_substitute (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL REFERENCES tenant(id),
    variant_id            UUID NOT NULL,   -- کالایی که موجود نیست
    substitute_variant_id UUID NOT NULL,   -- چیزی که به‌جایش پیشنهاد می‌شود
    note                  TEXT,            -- «همان اندازه، لعابِ مات» — برای نماینده
    sort_order            INT NOT NULL DEFAULT 0,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, variant_id, substitute_variant_id),
    CHECK (variant_id <> substitute_variant_id),
    FOREIGN KEY (tenant_id, variant_id)            REFERENCES product_variant(tenant_id, id),
    FOREIGN KEY (tenant_id, substitute_variant_id) REFERENCES product_variant(tenant_id, id)
);
CREATE INDEX idx_substitute_lookup ON product_substitute (tenant_id, variant_id, sort_order);

-- v2 «صف انتظار برای رزروهای آزادشده» (بخش ۹).
--
-- تفاوتش با stock_alert: آن اشتراکِ «خبرم کن» است و به همه پخش می‌شود (هرکس زودتر
-- کلیک کرد برنده)؛ این یک **صفِ منصفانه** است — وقتی موجودی آزاد شود، به ترتیبِ
-- نوبت برای نفرِ اولِ صف رزرو ساخته می‌شود، نه اینکه همه با هم بدوند.
CREATE TABLE waitlist_entry (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id),
    agent_account_id UUID NOT NULL,
    variant_id       UUID NOT NULL,
    quantity_boxes   INT  NOT NULL CHECK (quantity_boxes > 0),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),  -- ترتیبِ صف (FIFO)
    -- یک نوبت برای هر نماینده روی هر کالا. دوباره‌درخواست = به‌روزرسانیِ تعداد،
    -- نه گرفتنِ نوبتِ دوم — وگرنه با چند بار کلیک می‌شد صف را قبضه کرد.
    UNIQUE (agent_account_id, variant_id),
    FOREIGN KEY (tenant_id, agent_account_id) REFERENCES agent_account(tenant_id, id),
    FOREIGN KEY (tenant_id, variant_id)       REFERENCES product_variant(tenant_id, id)
);
CREATE INDEX idx_waitlist_queue ON waitlist_entry (tenant_id, variant_id, created_at);

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
-- v2 «کاتالوگ سفارشی برای مشتری» (spec ۱۲)
-- ---------------------------------------------------------------------------
-- نماینده زیرمجموعه‌ای از محصول‌ها را انتخاب می‌کند و یک لینکِ عمومیِ توکن‌دار برای
-- مشتریِ نهایی‌اش می‌فرستد. مشتری بدونِ لاگین فقط عکس + مشخصات + موجود/ناموجود
-- می‌بیند — نه قیمت (قیمتِ نماینده نباید نشت کند)، نه عددِ دقیقِ موجودی.
--
-- دسترسیِ عمومی: صفحه‌ی مشتری نشستی ندارد، پس RLSِ tenant کمکی نمی‌کند. URL شاملِ
-- slugِ tenant است (عمومی، نه راز) تا سرور tenant را از آن پیدا و withTenant را ست کند؛
-- «token» ظرفیتِ دسترسیِ غیرقابل‌حدس است. با is_active می‌شود لینک را بدونِ حذف باطل کرد.
CREATE TABLE shared_catalog (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    agent_account_id UUID NOT NULL,
    title            TEXT NOT NULL,
    token            TEXT NOT NULL UNIQUE,   -- در URL؛ غیرقابل‌حدس (crypto random سمتِ اپ)
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    -- opt-inِ نماینده: توضیحاتِ کاملِ محصول (متن/ابعاد/…) به مشتری نشان داده شود یا نه.
    -- گالری و مشخصاتِ پایه همیشه؛ این فقط توضیحاتِ اضافه را گِیت می‌کند.
    show_details     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, id),                  -- هدفِ composite FK
    FOREIGN KEY (tenant_id, agent_account_id)
        REFERENCES agent_account (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_shared_catalog_agent ON shared_catalog (tenant_id, agent_account_id, created_at DESC);

CREATE TABLE shared_catalog_item (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
    catalog_id     UUID NOT NULL,
    variant_id     UUID NOT NULL,
    -- قیمتِ فروشِ اختیاری که نماینده برای مشتری می‌گذارد (IRR). NULL = قیمت نشان نده.
    -- این «قیمتِ منِ» نماینده نیست — عددی است که خودش برای مشتری تعیین می‌کند.
    customer_price BIGINT CHECK (customer_price >= 0),
    sort_order     INT NOT NULL DEFAULT 0,
    UNIQUE (catalog_id, variant_id),         -- یک محصول دوبار در یک کاتالوگ نیاید
    FOREIGN KEY (tenant_id, catalog_id) REFERENCES shared_catalog   (tenant_id, id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, variant_id) REFERENCES product_variant  (tenant_id, id) ON DELETE CASCADE
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
RETURNS TABLE (tenant_id UUID, tenant_name TEXT, agent_account_id UUID, agent_legal_name TEXT, role TEXT,
               can_manage_access BOOLEAN, allowed_pages TEXT[],
               assigned_staff_name TEXT, assigned_staff_phone TEXT, currency_unit TEXT)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT t.id, t.name, aa.id, aa.legal_name, tm.role, tm.can_manage_access, tm.allowed_pages,
           su.full_name, su.phone, t.currency_unit
    FROM tenant_membership tm
    JOIN tenant t              ON t.id = tm.tenant_id AND t.is_active
    LEFT JOIN agent_account_user aau ON aau.user_id = tm.user_id AND aau.tenant_id = tm.tenant_id
    LEFT JOIN agent_account aa ON aa.id = aau.agent_account_id AND aa.is_active
    -- پشتیبانِ ثابتِ همین نمایندگی — فقط برای contextِ agent معنا دارد (پایین)
    LEFT JOIN app_user su ON su.id = aa.assigned_staff_user_id
    WHERE tm.user_id = p_user_id AND tm.is_active
$$;
REVOKE EXECUTE ON FUNCTION user_contexts(UUID) FROM PUBLIC;
-- در دیپلوی: GRANT EXECUTE ON FUNCTION user_contexts(UUID) TO <نقشِ اپ>;

-- ---------------------------------------------------------------------------
-- worker بوک‌کیپینگِ انقضا (spec ۵.۳ / ۹)
-- ---------------------------------------------------------------------------
-- رزروهای منقضی را active→expired می‌کند. **درستیِ available به این وابسته نیست**
-- (held همیشه `status='active' AND expires_at > now()` را می‌شمارد، پس رزروِ منقضی
-- حتی قبل از اجرای worker هم از held خارج است). این فقط بوک‌کیپینگ است: لیست‌ها،
-- گزارش‌ها و اعلان‌ها. تأخیر یا شکستش بی‌خطر است (runbook بخش ۶).
-- SECURITY DEFINER چون نگهداریِ cross-tenant است؛ امن است چون فقط رزروهایی را که
-- خودشان از مهلت گذشته‌اند علامت می‌زند و هیچ داده‌ای برنمی‌گرداند.
-- برمی‌گرداند: کدام (tenant, variant) موجودی‌شان آزاد شد — نه فقط یک عدد.
-- worker به این نیاز دارد تا صفِ انتظارِ همان کالاها را جلو ببرد؛ با شمارشِ خالی
-- می‌دانست «چیزی آزاد شد» ولی نه «چه چیزی»، و صف هرگز حرکت نمی‌کرد.
CREATE FUNCTION expire_due_reservations()
RETURNS TABLE (tenant_id UUID, variant_id UUID)
LANGUAGE sql SECURITY DEFINER AS $$
    WITH done AS (
        UPDATE reservation SET status = 'expired'
        WHERE status = 'active' AND expires_at <= now()
        RETURNING id, reservation.tenant_id
    )
    SELECT DISTINCT d.tenant_id, l.variant_id
    FROM done d
    JOIN reservation_item ri ON ri.reservation_id = d.id
    JOIN inventory_lot l ON l.id = ri.lot_id;
$$;
REVOKE EXECUTE ON FUNCTION expire_due_reservations() FROM PUBLIC;
-- در دیپلوی: GRANT EXECUTE ... TO <نقشِ worker>; و cron هر ۱۰-۱۵ دقیقه.

-- ---------------------------------------------------------------------------
-- worker پیامک (Outbox) — cross-tenant، پس مثل بالا SECURITY DEFINER
-- ---------------------------------------------------------------------------
-- چرا تابع و نه کوئری ساده: notification_outbox ستون tenant_id دارد، پس RLS رویش
-- فعال است. worker به یک tenant خاص تعلق ندارد و app.tenant_id ست نمی‌کند، بنابراین
-- با نقشِ اپ (non-superuser) هیچ ردیفی نمی‌دید و **بی‌صدا هیچ پیامی نمی‌فرستاد**.
-- این فقط در production ظاهر می‌شد چون dev با superuser وصل می‌شود و RLS دور می‌خورد.
-- امن است: نه ورودیِ tenant می‌گیرد و نه داده‌ای فراتر از صفِ پیام برمی‌گرداند.

-- برداشتِ اتمیکِ پیام‌های آماده (claim): attempt_count++ و SKIP LOCKED تا دو worker
-- هم‌زمان یک پیام را دوبار نفرستند.
-- tenant_id هم برمی‌گردد: worker برای sms باید بداند کدام tenant تا کانفیگِ
-- پیامکیِ همان tenant (sms_config) را برای انتخابِ پروایدر بخواند.
CREATE FUNCTION claim_pending_notifications(p_limit INT, p_max_attempts INT)
RETURNS TABLE (id UUID, tenant_id UUID, channel TEXT, recipient TEXT, payload JSONB, attempt_count INT)
LANGUAGE sql SECURITY DEFINER AS $$
    UPDATE notification_outbox SET attempt_count = notification_outbox.attempt_count + 1
    WHERE notification_outbox.id IN (
        SELECT o.id FROM notification_outbox o
        WHERE o.status = 'pending' AND o.attempt_count < p_max_attempts
        ORDER BY o.created_at
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING notification_outbox.id, notification_outbox.tenant_id, notification_outbox.channel,
              notification_outbox.recipient, notification_outbox.payload, notification_outbox.attempt_count;
$$;
REVOKE EXECUTE ON FUNCTION claim_pending_notifications(INT, INT) FROM PUBLIC;

-- ثبتِ نتیجه: موفق → sent، ناموفقِ رسیده به سقف → failed (dead-letter)، وگرنه pending می‌ماند.
CREATE FUNCTION finish_notification(p_id UUID, p_sent BOOLEAN, p_max_attempts INT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER AS $$
    UPDATE notification_outbox
    SET status = CASE WHEN p_sent THEN 'sent'
                      WHEN attempt_count >= p_max_attempts THEN 'failed'
                      ELSE 'pending' END,
        sent_at = CASE WHEN p_sent THEN now() ELSE sent_at END
    WHERE id = p_id;
$$;
REVOKE EXECUTE ON FUNCTION finish_notification(UUID, BOOLEAN, INT) FROM PUBLIC;

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
