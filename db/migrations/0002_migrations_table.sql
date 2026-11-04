-- =============================================================================
-- 0002_migrations_table.sql — جدولِ ردیابیِ migrationها
-- =============================================================================
-- این migration، اولین migration واقعی است (۰۰۰۱ همان schema.sql هست که در
-- نصبِ تازه اجرا می‌شود). جدول `_migrations` ردِ اجرای هر migration را نگه
-- می‌دارد تا `apply.ts` بداند کدام‌ها را اجرا کرده و کدام‌ها را نه.
--
-- چرا `IF NOT EXISTS`: اگر کاربری schema.sql را اجرا کرده باشد و بعداً این
-- migration را، نباید شکست بخورد — یعنی می‌خواهیم روی دیتابیسِ موجود هم
-- بدونِ مشکل اجرا شود.
--
-- نکته: GRANT به `app_user` در این migration نیست. اگر `app_user` وجود نداشته
-- باشد (مثلاً در dev یا CI که فقط `postgres` دارد)، GRANT خطا می‌دهد و
-- migration شکست می‌خورد. به‌جای DO $$ با EXCEPTION handling، GRANT را به
-- `apply.ts` منتقل کردیم — آنجا با try/catch مدیریت می‌شود.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS _migrations (
    id          INT PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    checksum    TEXT NOT NULL
);

REVOKE ALL ON _migrations FROM PUBLIC;
GRANT SELECT ON _migrations TO PUBLIC;

COMMIT;
