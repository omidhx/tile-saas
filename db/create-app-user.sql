-- =============================================================================
-- create-app-user.sql — ساخت نقش non-superuser برای runtime اپلیکیشن
-- =============================================================================
-- این اسکریپت باید با نقشِ superuser یا مالکِ دیتابیس اجرا شود.
-- نقشِ `app_user` نقشِ runtime اپلیکیشن است — بدونِ SUPERUSER و بدونِ BYPASSRLS.
--
-- ⚠️ نقشِ migration (مالکِ جدول‌ها) باید جدا از runtime باشد.
--    migration با مالکِ جدول (یا superuser) اجرا می‌شود.
--    runtime با `app_user` اجرا می‌شود که فقط DML دارد نه DDL.
--
-- دستی اجرا نمی‌شود: web/scripts/migrate.ts آن را اجرا می‌کند و رمز را از APP_USER_PASSWORD می‌گیرد.
-- reset تست‌ها همین فایل را می‌خوانند، پس نقشِ تست و production یکی است.
-- =============================================================================

-- ۱. ساخت نقش (اگر وجود ندارد)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
        -- بدون رمز، تا کسی با مقدار پیش‌فرضِ معلوم وارد نشود.
        CREATE ROLE app_user LOGIN NOBYPASSRLS;
    END IF;
END $$;

-- ۲. اطمینان از اینکه نقش superuser یا BYPASSRLS ندارد
ALTER ROLE app_user NOSUPERUSER NOBYPASSRLS;

-- ۳. دسترسی به schema
GRANT USAGE ON SCHEMA public TO app_user;

-- ۴. دسترسی به جدول‌های tenant-scoped (CRUD کامل — RLS ایزوله می‌کند)
--    این جداول توسط RLS محافظت می‌شوند، پس app_user می‌تواند DML بزند
--    ولی فقط روی داده‌ی tenant خودش.
GRANT SELECT, INSERT, UPDATE, DELETE ON
    agent_account, agent_account_user, agent_price_override,
    audit_log, brand, customer,
    import_batch, import_row, import_template,
    incoming_stock, inventory_balance, inventory_lot, inventory_transaction,
    pallet, pallet_item,
    notification_outbox, price_list, price_list_item,
    product, product_image, product_substitute, product_variant,
    reservation, reservation_item,
    sales_dispatch, sales_dispatch_item,
    sales_request, sales_request_allocation, sales_request_item,
    shared_catalog, shared_catalog_item,
    stock_alert, tenant_membership,
    volume_discount, waitlist_entry, warehouse, warehouse_cell
TO app_user;

-- ۵. جداول سراسری (غیر tenant-scoped)
--    app_user: ورود session_epoch را بالا می‌برد، تغییر رمز و ساخت حساب هم می‌نویسند
--    tenant: تنظیمات کارخانه و ساخت کارخانه توسط مدیر پلتفرم
--    password_reset: SELECT, INSERT, UPDATE (برای reset flow)
GRANT SELECT, INSERT, UPDATE ON app_user TO app_user;
GRANT SELECT, INSERT, UPDATE ON tenant TO app_user;
GRANT SELECT, INSERT, UPDATE ON password_reset TO app_user;
GRANT SELECT ON v_lot_availability TO app_user;

-- ۶. جداول زیرساختی — least privilege
--    _migrations: فقط SELECT (migrate.ts با نقش superuser اجرا می‌شود)
--    _rate_limit_hits: SELECT, INSERT, DELETE (rate limiter نیاز دارد)
GRANT SELECT ON _migrations TO app_user;
GRANT SELECT, INSERT, DELETE ON _rate_limit_hits TO app_user;

-- ۷. Sequences
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ۸. توابع SECURITY DEFINER
--    هر چهار تابع REVOKE FROM PUBLIC شده‌اند در schema.sql.
--    این GRANT فقط به app_user می‌دهد.
GRANT EXECUTE ON FUNCTION user_contexts(UUID) TO app_user;
GRANT EXECUTE ON FUNCTION expire_due_reservations() TO app_user;
GRANT EXECUTE ON FUNCTION claim_pending_notifications(INT, INT) TO app_user;
GRANT EXECUTE ON FUNCTION finish_notification(UUID, BOOLEAN, INT) TO app_user;

-- بکاپ با --no-privileges گرفته می‌شود؛ بعد از بازیابی این REVOKEهای schema.sql برنمی‌گردند مگر اینجا.
REVOKE EXECUTE ON FUNCTION user_contexts(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION expire_due_reservations() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION claim_pending_notifications(INT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION finish_notification(UUID, BOOLEAN, INT) FROM PUBLIC;
REVOKE ALL ON _rate_limit_hits FROM PUBLIC;

-- ۹. جداول آینده هم GRANT بگیرند (برای migrationهای بعدی)
--    فقط روی جدول‌های tenant-scoped — مالک باید این را بعد از CREATE TABLE بزند
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO app_user;

-- ۱۰. تأیید نهایی — نقش نباید SUPERUSER یا BYPASSRLS باشد
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
