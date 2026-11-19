-- =============================================================================
-- 0009_pallets.sql — پالت با محل زیرِ Lot (فاز ۷، تصمیم ۲۰۲۶-۱۱-۰۷)
-- =============================================================================
-- همان تعریفِ schema.sql بخش ۵.۴ب. روی نصبِ تازه بعد از schema.sql هم اجرا می‌شود، پس هر قدم idempotent است.
-- موجودیِ فعلی: برای هر lot با on_hand > 0 یک پالتِ «بدون محل» با همان تعداد ساخته می‌شود، تا ناوردای
-- «جمعِ پالت‌ها = on_hand» از همین لحظه برقرار باشد. کارمند بعداً با «انتقال» آن را جابه‌جا و تقسیم می‌کند.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_lot_tenant_id_id_warehouse_id_key') THEN
        ALTER TABLE inventory_lot ADD CONSTRAINT inventory_lot_tenant_id_id_warehouse_id_key UNIQUE (tenant_id, id, warehouse_id);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS pallet (
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id),
    pallet_no    BIGINT GENERATED ALWAYS AS IDENTITY,
    warehouse_id UUID NOT NULL,
    column_code  TEXT CHECK (column_code IS NULL OR length(btrim(column_code)) BETWEEN 1 AND 40),
    position_no  INT CHECK (position_no > 0),
    note         TEXT,
    created_by   UUID REFERENCES app_user(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, id, warehouse_id),
    FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouse(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS pallet_item (
    id           UUID NOT NULL DEFAULT gen_random_uuid(),
    tenant_id    UUID NOT NULL REFERENCES tenant(id),
    pallet_id    UUID NOT NULL,
    lot_id       UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    qty_boxes    INT NOT NULL CHECK (qty_boxes > 0),
    PRIMARY KEY (id),
    UNIQUE (pallet_id, lot_id),
    FOREIGN KEY (tenant_id, pallet_id, warehouse_id) REFERENCES pallet(tenant_id, id, warehouse_id),
    FOREIGN KEY (tenant_id, lot_id, warehouse_id)    REFERENCES inventory_lot(tenant_id, id, warehouse_id)
);
CREATE INDEX IF NOT EXISTS idx_pallet_item_lot ON pallet_item (lot_id) INCLUDE (qty_boxes);

CREATE OR REPLACE FUNCTION check_pallet_sum() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_lot UUID;
    v_on  INT;
    v_sum INT;
    v_tenant UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;  -- ایندکسِ balance روی (tenant_id, lot_id) است
BEGIN
    FOR v_lot IN
        SELECT DISTINCT x FROM unnest(ARRAY[
            CASE WHEN TG_OP <> 'INSERT' THEN OLD.lot_id END,
            CASE WHEN TG_OP <> 'DELETE' THEN NEW.lot_id END]) AS x
        WHERE x IS NOT NULL
    LOOP
        SELECT on_hand_qty_boxes INTO v_on FROM inventory_balance WHERE tenant_id = v_tenant AND lot_id = v_lot FOR UPDATE;
        SELECT COALESCE(SUM(qty_boxes), 0) INTO v_sum FROM pallet_item WHERE tenant_id = v_tenant AND lot_id = v_lot;
        IF COALESCE(v_on, 0) <> v_sum THEN
            RAISE EXCEPTION 'pallet_sum_mismatch: lot % on_hand=% pallets=%', v_lot, COALESCE(v_on, 0), v_sum
                USING ERRCODE = '23514';
        END IF;
    END LOOP;
    RETURN NULL;
END $$;

-- پالتِ «بدون محل» برای موجودیِ فعلی، قبل از روشن شدنِ تریگر (lotی که هنوز پالت ندارد)
WITH s AS MATERIALIZED (
    SELECT gen_random_uuid() AS pid, b.tenant_id, b.lot_id, l.warehouse_id, b.on_hand_qty_boxes AS q
    FROM inventory_balance b JOIN inventory_lot l ON l.id = b.lot_id
    WHERE b.on_hand_qty_boxes > 0
      AND NOT EXISTS (SELECT 1 FROM pallet_item pi WHERE pi.lot_id = b.lot_id)
), p AS (
    INSERT INTO pallet (id, tenant_id, warehouse_id, note)
    SELECT pid, tenant_id, warehouse_id, 'موجودیِ قبل از پالت (migration 0009)' FROM s
)
INSERT INTO pallet_item (tenant_id, pallet_id, lot_id, warehouse_id, qty_boxes)
SELECT tenant_id, pid, lot_id, warehouse_id, q FROM s;

DROP TRIGGER IF EXISTS balance_pallet_sum ON inventory_balance;
CREATE CONSTRAINT TRIGGER balance_pallet_sum
    AFTER INSERT OR UPDATE OF on_hand_qty_boxes ON inventory_balance
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_pallet_sum();
DROP TRIGGER IF EXISTS pallet_item_sum ON pallet_item;
CREATE CONSTRAINT TRIGGER pallet_item_sum
    AFTER INSERT OR UPDATE OR DELETE ON pallet_item
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_pallet_sum();

ALTER TABLE pallet ENABLE ROW LEVEL SECURITY;
ALTER TABLE pallet FORCE ROW LEVEL SECURITY;
ALTER TABLE pallet_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE pallet_item FORCE ROW LEVEL SECURITY;
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['pallet', 'pallet_item'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = 'tenant_isolation') THEN
            EXECUTE format($f$
                CREATE POLICY tenant_isolation ON %I
                USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
                WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid)
            $f$, t);
        END IF;
    END LOOP;
END $$;
COMMIT;
