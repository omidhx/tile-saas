-- =============================================================================
-- 0010_warehouse_map.sql — نقشه‌ی انبار: خانه‌های شبکه (فاز ۸، تصمیم ۲۰۲۶-۱۱-۱۲)
-- =============================================================================
-- همان تعریفِ schema.sql بخش ۵.۴ج. روی نصبِ تازه بعد از schema.sql هم اجرا می‌شود، پس idempotent است.
-- پالت عوض نمی‌شود: pallet.column_code و position_no همان‌طور که هستند می‌مانند و پالت با همین دو مقدار
-- روی خانه‌ی نقشه نشان داده می‌شود. پس دادهِ موجود migration لازم ندارد؛ پالتی که محلش روی نقشه نیست
-- در «بیرون از نقشه» دیده می‌شود.
BEGIN;

CREATE TABLE IF NOT EXISTS warehouse_cell (
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id),
    warehouse_id UUID NOT NULL,
    x            INT NOT NULL CHECK (x BETWEEN 0 AND 59),
    y            INT NOT NULL CHECK (y BETWEEN 0 AND 59),
    kind         TEXT NOT NULL CHECK (kind IN ('slot', 'aisle')),
    column_code  TEXT CHECK (column_code IS NULL OR length(btrim(column_code)) BETWEEN 1 AND 40),
    position_no  INT CHECK (position_no > 0),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, warehouse_id, x, y),
    FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouse(tenant_id, id),
    CHECK ((kind = 'slot') = (column_code IS NOT NULL AND position_no IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_cell_slot
    ON warehouse_cell (tenant_id, warehouse_id, upper(translate(btrim(column_code), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يك', '01234567890123456789یک')), position_no) WHERE kind = 'slot';

ALTER TABLE warehouse_cell ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_cell FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'warehouse_cell' AND policyname = 'tenant_isolation') THEN
        CREATE POLICY tenant_isolation ON warehouse_cell
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    END IF;
END $$;
COMMIT;
