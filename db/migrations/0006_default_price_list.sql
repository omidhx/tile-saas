-- =============================================================================
-- 0006_default_price_list.sql — «لیست اصلی» هر کارخانه (فاز ۲)
-- =============================================================================
-- وقتی کلیدِ «چند لیست قیمت» خاموش است، همه‌ی نماینده‌ها از همین لیست قیمت می‌گیرند.
-- کارخانه‌ای که از قبل لیست دارد: اولین لیست به ترتیبِ نام، لیستِ اصلی می‌شود.
BEGIN;
ALTER TABLE price_list ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_list_default ON price_list(tenant_id) WHERE is_default;
UPDATE price_list pl SET is_default = TRUE
WHERE pl.id = (SELECT x.id FROM price_list x WHERE x.tenant_id = pl.tenant_id ORDER BY x.name, x.id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM price_list d WHERE d.tenant_id = pl.tenant_id AND d.is_default);
COMMIT;
