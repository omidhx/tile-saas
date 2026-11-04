-- =============================================================================
-- 0005_tenant_features.sql — امکاناتِ اختیاریِ هر کارخانه (فاز ۲)
-- =============================================================================
-- مقدارهای پیش‌فرض در کد است (web/src/lib/features.ts)؛ '{}' یعنی همان پیش‌فرض‌ها.
BEGIN;
ALTER TABLE tenant ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb;

-- کارخانه‌ی موجود هرچه واقعاً داده دارد روشن می‌ماند، وگرنه ارتقا بی‌صدا قیمت‌هایش را عوض می‌کند.
UPDATE tenant t SET features = jsonb_build_object(
  'pricing', TRUE,
  'price_lists', EXISTS (SELECT 1 FROM agent_account a WHERE a.tenant_id = t.id AND a.price_list_id IS NOT NULL),
  'agent_price', EXISTS (SELECT 1 FROM agent_price_override o WHERE o.tenant_id = t.id),
  'volume_discount', EXISTS (SELECT 1 FROM volume_discount v WHERE v.tenant_id = t.id),
  'auto_approve', t.auto_approve_limit IS NOT NULL
    OR EXISTS (SELECT 1 FROM agent_account a WHERE a.tenant_id = t.id AND a.auto_approve_limit IS NOT NULL),
  'substitutes', EXISTS (SELECT 1 FROM product_substitute p WHERE p.tenant_id = t.id)
)
WHERE t.features = '{}'::jsonb;
COMMIT;
