-- =============================================================================
-- 0002_migrations_table.sql — جدولِ ردیابیِ migrationها
-- =============================================================================
-- این migration، اولین migration واقعی است (۰۰۰۱ همان schema.sql هست که در
-- نصبِ تازه اجرا می‌شود). جدول `_migrations` ردِ اجرای هر migration را نگه
-- می‌دارد تا `apply.ts` بداند کدام‌ها را اجرا کرده و کدام‌ها را نه.
--
-- چرا `IF NOT EXISTS`: اگر کاربری schema.sql را اجرا کرده باشد و بعداً این
-- migration را، نباید شکست بخورد — یعنی می‌خواهیم روی دیتابیسِ موجود هم
-- بدونِ مشکل اجرا شود (upgrade از حالتِ بدون-migration به حالتِ با-migration).
--
-- چرا در schemaیِ public: این جدول tenant-scoped نیست — ردیابیِ migration
-- سراسری است، نه به ازای هر tenant. RLS روی این جدول فعال نیست.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS _migrations (
    id          INT PRIMARY KEY,                          -- شماره‌ی ترتیبیِ migration (۰۰۰۲، ۰۰۰۳، …)
    name        TEXT NOT NULL,                            -- نام فایل (بدونِ پسوند)
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),       -- زمانِ اجرا
    checksum    TEXT NOT NULL                            -- SHA-256 فایل برای تشخیصِ دستکاری
);

-- _migrations رویِ RLS نیست چون tenant_id ندارد و نباید داشته باشد.
-- ولی رویِ public است، پس فقط نقشِ app_owner / superuser حقِ نوشتن دارد.
-- نقشِ اپ (app_user) فقط SELECT دارد تا ببیند کدام‌ها اجرا شده.
REVOKE ALL ON _migrations FROM PUBLIC;
GRANT SELECT ON _migrations TO PUBLIC;  -- خواندن برای همه (اطلاعاتِ حساسی ندارد)

-- =============================================================================
-- GRANT صریح برای نقشِ اپ (app_user) — مهم
-- =============================================================================
-- `GRANT ... ON ALL TABLES` در نصبِ تازه فقط جدول‌های همان لحظه را می‌گیرد.
-- `_migrations` بعداً ساخته می‌شود، پس باید صریحاً به `app_user` داده شود.
-- اگر این GRANT نباشد، `apply.ts` با `app_user` نمی‌تواند INSERT بزند.
--
-- چرا `IF EXISTS` در check: شاید کاربر نقش `app_user` را هنوز نساخته باشد
-- (مثلاً در dev). در production باید ساخته شده باشد.
-- =============================================================================
DO $$
BEGIN
    -- اطمینان از اینکه GRANT فقط وقتی زده می‌شود که نقش وجود دارد
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        GRANT SELECT ON _migrations TO app_user;
        -- apply.ts با app_owner اجرا می‌شود، نه app_user. app_user فقط SELECT دارد.
        -- این جدول نباید توسط اپ نوشته شود.
    END IF;
END $$;

COMMIT;
