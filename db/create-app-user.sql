-- =============================================================================
-- create-app-user.sql — ساخت نقش non-superuser برای اپلیکیشن
-- =============================================================================
-- این اسکریپت باید با نقشِ superuser یا مالکِ دیتابیس اجرا شود.
-- نقشِ `app_user` نقشِ runtime اپلیکیشن است — بدونِ SUPERUSER و بدونِ BYPASSRLS.
--
-- اجرا:
--   psql "$DATABASE_URL" -f db/create-app-user.sql
--
-- ⚠️ این اسکریپت را فقط یک‌بار اجرا کنید. اگر نقش وجود دارد، GRANTها
-- idempotent هستند (خطا نمی‌دهند).
-- =============================================================================

-- ۱. ساخت نقش (اگر وجود ندارد)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user LOGIN PASSWORD 'CHANGE_ME_IN_PRODUCTION';
        RAISE NOTICE 'نقش app_user ساخته شد. رمز را حتماً عوض کنید!';
    ELSE
        RAISE NOTICE 'نقش app_user از قبل وجود دارد.';
    END IF;
END $$;

-- ۲. دسترسی به schema
GRANT USAGE ON SCHEMA public TO app_user;

-- ۳. دسترسی به همه‌ی جدول‌های موجود (و آینده با ALTER DEFAULT PRIVILEGES)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ۴. جداول آینده هم GRANT بگیرند (مثل _migrations که بعد از schema.sql ساخته می‌شود)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ۵. دسترسی به توابع SECURITY DEFINER
GRANT EXECUTE ON FUNCTION user_contexts(UUID) TO app_user;
GRANT EXECUTE ON FUNCTION expire_due_reservations() TO app_user;
GRANT EXECUTE ON FUNCTION claim_pending_notifications(INT, INT) TO app_user;
GRANT EXECUTE ON FUNCTION finish_notification(UUID, BOOLEAN, INT) TO app_user;

-- ۶. تأیید: نقش نباید SUPERUSER یا BYPASSRLS باشد
SELECT
    rolname,
    rolsuper,
    rolbypassrls,
    rolcanlogin
FROM pg_roles
WHERE rolname = 'app_user';

-- نتیجه‌ی مورد انتظار:
--   rolname  | rolsuper | rolbypassrls | rolcanlogin
--   ---------+----------+-------------+------------
--   app_user | f        | f           | t
--
-- اگر rolsuper یا rolbypassrls روی t بود، اپ با این نقش ناامن است!
