-- =============================================================================
-- تست دود (smoke test) برای schema.sql — قوانین حیاتیِ مسیر پول/موجودی.
-- اجرا بعد از schema.sql. هر assert که بشکنه، اجرا با خطا متوقف می‌شه (ON_ERROR_STOP).
-- پوشش: (۱) محاسبه‌ی available، (۲) منع oversell، (۳) guard مسیر backorder، (۴) RLS.
-- =============================================================================

-- نقش اپ برای تست RLS (non-superuser تا RLS واقعاً اعمال شه)
CREATE ROLE app_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO app_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO app_role;

-- --- Seed: tenant A ---
INSERT INTO tenant (id, name, slug) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Factory A', 'factory-a');
INSERT INTO app_user (id, phone, password_hash) VALUES
    ('a8888888-8888-8888-8888-888888888888', '09100000000', 'x');
INSERT INTO product (id, tenant_id, code, name) VALUES
    ('a1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'P1', 'Tile P1');
INSERT INTO product_variant (id, tenant_id, product_id, sku, boxes_per_pallet) VALUES
    ('a2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
     'a1111111-1111-1111-1111-111111111111', 'P1-G1', 96);
INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES
    ('a3333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111', 'Main', 'W1', 'main');
INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id, batch_number) VALUES
    ('a4444444-4444-4444-4444-444444444444', '11111111-1111-1111-1111-111111111111',
     'a2222222-2222-2222-2222-222222222222', 'a3333333-3333-3333-3333-333333333333', 'B-001');
INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes, allocated_qty_boxes, blocked_qty_boxes) VALUES
    ('11111111-1111-1111-1111-111111111111', 'a4444444-4444-4444-4444-444444444444', 100, 30, 10);
INSERT INTO agent_account (id, tenant_id, legal_name, code) VALUES
    ('a5555555-5555-5555-5555-555555555555', '11111111-1111-1111-1111-111111111111', 'Agent A', 'AG1');
INSERT INTO reservation (id, tenant_id, agent_account_id, expires_at) VALUES
    ('a6666666-6666-6666-6666-666666666666', '11111111-1111-1111-1111-111111111111',
     'a5555555-5555-5555-5555-555555555555', now() + interval '1 day');
INSERT INTO reservation_item (tenant_id, reservation_id, lot_id, quantity_boxes) VALUES
    ('11111111-1111-1111-1111-111111111111', 'a6666666-6666-6666-6666-666666666666',
     'a4444444-4444-4444-4444-444444444444', 20);
INSERT INTO sales_dispatch (id, tenant_id, agent_account_id, dispatch_code, created_by_user_id) VALUES
    ('a7777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111',
     'a5555555-5555-5555-5555-555555555555', 'D-001', 'a8888888-8888-8888-8888-888888888888');

-- --- Seed: tenant B (برای تست ایزوله) ---
INSERT INTO tenant (id, name, slug) VALUES
    ('22222222-2222-2222-2222-222222222222', 'Factory B', 'factory-b');
INSERT INTO product (id, tenant_id, code, name) VALUES
    ('b1111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'P1', 'Tile B-P1');
INSERT INTO product_variant (id, tenant_id, product_id, sku) VALUES
    ('b2222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222',
     'b1111111-1111-1111-1111-111111111111', 'BP1-G1');
INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES
    ('b3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'Main', 'W1', 'main');
INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id) VALUES
    ('b4444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222',
     'b2222222-2222-2222-2222-222222222222', 'b3333333-3333-3333-3333-333333333333');

-- =========================================================================
-- تست ۱: available = on_hand(100) − held(20) − allocated(30) − blocked(10) = 40
-- =========================================================================
DO $$
DECLARE v_avail INT; v_held INT;
BEGIN
    SELECT available_qty_boxes, held_qty_boxes INTO v_avail, v_held
    FROM v_lot_availability WHERE lot_id = 'a4444444-4444-4444-4444-444444444444';
    ASSERT v_held  = 20, format('held باید ۲۰ باشه، شد %s', v_held);
    ASSERT v_avail = 40, format('available باید ۴۰ باشه، شد %s', v_avail);
    RAISE NOTICE 'تست ۱ (محاسبه‌ی available) OK';
END $$;

-- تست ۱ب: رزرو منقضی نباید در held بیاد
-- (created_at هم عقب می‌ره تا CHECK expires_at>created_at نقض نشه — همون CHECK که
--  در اجرای قبلی درست جلوی یه تستِ ساده‌لوحانه رو گرفت و اثبات کرد فعاله)
DO $$
DECLARE v_held INT;
BEGIN
    UPDATE reservation
    SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'
    WHERE id = 'a6666666-6666-6666-6666-666666666666';
    SELECT held_qty_boxes INTO v_held FROM v_lot_availability
    WHERE lot_id = 'a4444444-4444-4444-4444-444444444444';
    ASSERT v_held = 0, format('رزرو منقضی نباید held بسازه، شد %s', v_held);
    UPDATE reservation
    SET created_at = now(), expires_at = now() + interval '1 day'
    WHERE id = 'a6666666-6666-6666-6666-666666666666';
    RAISE NOTICE 'تست ۱ب (رزرو منقضی از held خارج) OK';
END $$;

-- =========================================================================
-- تست ۲: منع oversell — allocated+blocked نباید از on_hand بیشتر شه (قانون #۲)
-- =========================================================================
DO $$
BEGIN
    BEGIN
        UPDATE inventory_balance SET allocated_qty_boxes = 95, blocked_qty_boxes = 10
        WHERE lot_id = 'a4444444-4444-4444-4444-444444444444';   -- 95+10 > 100
        RAISE EXCEPTION 'تست ۲ شکست: CHECK باید oversell رو رد می‌کرد';
    EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'تست ۲ (منع oversell) OK';
    END;
END $$;

-- =========================================================================
-- تست ۳: guard مسیر backorder — in_stock نیازمند lot، backorder نیازمند NULL
-- =========================================================================
DO $$
BEGIN
    BEGIN
        INSERT INTO sales_dispatch_item (tenant_id, dispatch_id, fulfillment_type, variant_id, quantity_boxes)
        VALUES ('11111111-1111-1111-1111-111111111111', 'a7777777-7777-7777-7777-777777777777',
                'in_stock', 'a2222222-2222-2222-2222-222222222222', 5);
        RAISE EXCEPTION 'تست ۳الف شکست: in_stock بدون lot باید رد می‌شد';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        INSERT INTO sales_dispatch_item (tenant_id, dispatch_id, lot_id, fulfillment_type, variant_id, quantity_boxes)
        VALUES ('11111111-1111-1111-1111-111111111111', 'a7777777-7777-7777-7777-777777777777',
                'a4444444-4444-4444-4444-444444444444', 'backorder', 'a2222222-2222-2222-2222-222222222222', 5);
        RAISE EXCEPTION 'تست ۳ب شکست: backorder با lot باید رد می‌شد';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    INSERT INTO sales_dispatch_item (tenant_id, dispatch_id, fulfillment_type, backorder_status, variant_id, quantity_boxes)
    VALUES ('11111111-1111-1111-1111-111111111111', 'a7777777-7777-7777-7777-777777777777',
            'backorder', 'pending_production', 'a2222222-2222-2222-2222-222222222222', 5);
    RAISE NOTICE 'تست ۳ (guard backorder) OK';
END $$;

-- =========================================================================
-- تست ۴: RLS — نماینده‌ی تننت A نباید داده‌ی تننت B رو ببینه (بخش ۸، IDOR)
-- =========================================================================
DO $$
DECLARE v_a INT; v_b INT; v_all INT;
BEGIN
    SET LOCAL ROLE app_role;
    PERFORM set_config('app.tenant_id', '11111111-1111-1111-1111-111111111111', true);
    SELECT count(*) INTO v_a   FROM inventory_lot WHERE tenant_id = '11111111-1111-1111-1111-111111111111';
    SELECT count(*) INTO v_b   FROM inventory_lot WHERE tenant_id = '22222222-2222-2222-2222-222222222222';
    SELECT count(*) INTO v_all FROM inventory_lot;
    RESET ROLE;
    ASSERT v_a   = 1, format('تننت A باید lot خودش رو ببینه، شد %s', v_a);
    ASSERT v_b   = 0, format('تننت A نباید lot تننت B رو ببینه، شد %s', v_b);
    ASSERT v_all = 1, format('RLS باید فقط ردیف‌های A رو بده، کل شد %s', v_all);
    RAISE NOTICE 'تست ۴ (ایزوله‌ی RLS بین تننت‌ها) OK';
END $$;

-- =========================================================================
-- تست ۵: user_contexts از RLS عبور می‌کنه (bootstrap هویتِ cross-tenant)
-- =========================================================================
GRANT EXECUTE ON FUNCTION user_contexts(UUID) TO app_role;
INSERT INTO tenant_membership (tenant_id, user_id, role, is_active)
  VALUES ('11111111-1111-1111-1111-111111111111', 'a8888888-8888-8888-8888-888888888888', 'agent', true);
INSERT INTO agent_account_user (tenant_id, agent_account_id, user_id, role)
  VALUES ('11111111-1111-1111-1111-111111111111', 'a5555555-5555-5555-5555-555555555555',
          'a8888888-8888-8888-8888-888888888888', 'operator');
DO $$
DECLARE v_n INT; v_t UUID;
BEGIN
    SET LOCAL ROLE app_role;
    -- app.tenant_id عمداً ست نشده — یعنی RLS باید همه‌چی رو فیلتر کنه، ولی تابعِ
    -- SECURITY DEFINER بازم context کاربر رو می‌ده. این کلِ هدفِ تابعه.
    SELECT count(*) INTO v_n FROM user_contexts('a8888888-8888-8888-8888-888888888888');
    SELECT tenant_id INTO v_t FROM user_contexts('a8888888-8888-8888-8888-888888888888') LIMIT 1;
    RESET ROLE;
    ASSERT v_n = 1, format('باید ۱ context برگرده (tenant B نباید بیاد)، شد %s', v_n);
    ASSERT v_t = '11111111-1111-1111-1111-111111111111', 'context باید tenant A باشه';
    RAISE NOTICE 'تست ۵ (user_contexts از RLS عبور می‌کنه) OK';
END $$;

SELECT 'همه‌ی تست‌ها پاس شدن' AS result;
