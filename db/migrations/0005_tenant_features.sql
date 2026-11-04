-- =============================================================================
-- 0005_tenant_features.sql — امکاناتِ اختیاریِ هر کارخانه (فاز ۲)
-- =============================================================================
-- مقدارهای پیش‌فرض در کد است (web/src/lib/features.ts)؛ '{}' یعنی همان پیش‌فرض‌ها.
BEGIN;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMIT;
