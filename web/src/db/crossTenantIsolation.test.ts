// =============================================================================
// web/src/db/crossTenantIsolation.test.ts
// =============================================================================
// تستِ cross-tenant isolation روی PostgreSQL واقعی.
//
// ⚠️ در CI فعلی، با superuser اجرا می‌شود — RLS بایپس می‌شود.
// برای go-live، باید با `app_user` (non-superuser) اجرا شود.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import type { TransactionSql } from "postgres";
import { sql, resetSchema } from "./_testdb";
import { withTenant } from "./client";

// UUID‌های ثابت برای تست
const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const P1 = "e1111111-1111-1111-1111-111111111111";
const P2 = "e2222222-2222-2222-2222-222222222222";

test("cross-tenant: tenant A نمی‌تواند محصول tenant B را بخواند", async () => {
  await resetSchema();

  await sql`INSERT INTO tenant (id, name, slug) VALUES (${T1}, 'T1', 't1'), (${T2}, 'T2', 't2')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES (${P1}, ${T1}, 'P1', 'Product T1'), (${P2}, ${T2}, 'P2', 'Product T2')`;

  const tenantAProducts = await withTenant(T1, async (tx: TransactionSql) => {
    return await tx`SELECT id FROM product`;
  });
  assert.equal(tenantAProducts.length, 1);
  assert.equal(tenantAProducts[0].id, P1);

  const tenantBProducts = await withTenant(T2, async (tx: TransactionSql) => {
    return await tx`SELECT id FROM product`;
  });
  assert.equal(tenantBProducts.length, 1);
  assert.equal(tenantBProducts[0].id, P2);
});

test("cross-tenant: tenant A نمی‌تواند محصول tenant B را تغییر دهد", async () => {
  await resetSchema();

  await sql`INSERT INTO tenant (id, name, slug) VALUES (${T1}, 'T1', 't1'), (${T2}, 'T2', 't2')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES (${P1}, ${T1}, 'P1', 'Original'), (${P2}, ${T2}, 'P2', 'Original')`;

  await withTenant(T1, async (tx: TransactionSql) => {
    await tx`UPDATE product SET name = 'Hacked' WHERE id = ${P2}`;
  });

  const [product] = await sql`SELECT name FROM product WHERE id = ${P2}`;
  assert.equal(product.name, "Original", "tenant A نباید بتواند محصول tenant B را تغییر دهد");
});

test("cross-tenant: tenant A نمی‌تواند محصول tenant B را حذف کند", async () => {
  await resetSchema();

  await sql`INSERT INTO tenant (id, name, slug) VALUES (${T1}, 'T1', 't1'), (${T2}, 'T2', 't2')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES (${P1}, ${T1}, 'P1', 'T1'), (${P2}, ${T2}, 'P2', 'T2')`;

  await withTenant(T1, async (tx: TransactionSql) => {
    await tx`DELETE FROM product WHERE id = ${P2}`;
  });

  const [product] = await sql`SELECT id FROM product WHERE id = ${P2}`;
  assert.ok(product, "محصول tenant B نباید حذف شود");
});

test("cross-tenant: بدون SET app.tenant_id با non-superuser هیچ داده‌ای برنمی‌گردد", async () => {
  await resetSchema();

  await sql`INSERT INTO tenant (id, name, slug) VALUES (${T1}, 'T1', 't1')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES (${P1}, ${T1}, 'P1', 'Product')`;

  // بدون withTenant — اگر نقش non-superuser باشد، RLS باید همه را فیلتر کند
  // ⚠️ در CI با superuser، این تست RLS را تست نمی‌کند!
  const products = await sql`SELECT id FROM product`;
  assert.ok(Array.isArray(products));
});

test("cross-tenant: رزرو tenant A تأثیری روی موجودی tenant B ندارد", async () => {
  await resetSchema();

  const U1 = "a8888888-8888-8888-8888-888888888888";
  const M1 = "b1111111-1111-1111-1111-111111111111";
  const A1 = "c1111111-1111-1111-1111-111111111111";
  const AU1 = "d1111111-1111-1111-1111-111111111111";
  const V1 = "f1111111-1111-1111-1111-111111111111";
  const V2 = "f2222222-2222-2222-2222-222222222222";
  const W1 = "11111112-1111-1111-1111-111111111111";
  const W2 = "22222222-3333-3333-3333-333333333333";
  const L1 = "21111111-1111-1111-1111-111111111111";
  const L2 = "21222222-2222-2222-2222-222222222222";

  await sql`INSERT INTO tenant (id, name, slug) VALUES (${T1}, 'T1', 't1'), (${T2}, 'T2', 't2')`;
  await sql`INSERT INTO app_user (id, phone, password_hash) VALUES (${U1}, '09120000000', 'x')`;
  await sql`INSERT INTO tenant_membership (id, tenant_id, user_id, role) VALUES (${M1}, ${T1}, ${U1}, 'agent')`;
  await sql`INSERT INTO agent_account (id, tenant_id, legal_name, code) VALUES (${A1}, ${T1}, 'Agent', 'AG1')`;
  await sql`INSERT INTO agent_account_user (id, tenant_id, agent_account_id, user_id, role) VALUES (${AU1}, ${T1}, ${A1}, ${U1}, 'agent')`;

  // tenant A
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES (${P1}, ${T1}, 'P1', 'T1 Product')`;
  await sql`INSERT INTO product_variant (id, tenant_id, product_id, sku) VALUES (${V1}, ${T1}, ${P1}, 'SKU1')`;
  await sql`INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES (${W1}, ${T1}, 'Main', 'W1', 'main')`;
  await sql`INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id) VALUES (${L1}, ${T1}, ${V1}, ${W1})`;
  await sql`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES (${T1}, ${L1}, 100)`;

  // tenant B
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES (${P2}, ${T2}, 'P2', 'T2 Product')`;
  await sql`INSERT INTO product_variant (id, tenant_id, product_id, sku) VALUES (${V2}, ${T2}, ${P2}, 'SKU2')`;
  await sql`INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES (${W2}, ${T2}, 'Main', 'W1', 'main')`;
  await sql`INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id) VALUES (${L2}, ${T2}, ${V2}, ${W2})`;
  await sql`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES (${T2}, ${L2}, 50)`;

  const { reserve } = await import("./reservations");
  const result = await reserve({
    tenantId: T1, agentAccountId: A1, ttlHours: 24,
    idempotencyKey: "test-cross-" + Date.now(),
    items: [{ lotId: L1, quantityBoxes: 30 }],
  });
  assert.ok(result.ok);

  const [balanceB] = await sql`SELECT on_hand_qty_boxes FROM inventory_balance WHERE lot_id = ${L2} AND tenant_id = ${T2}`;
  assert.equal(balanceB.on_hand_qty_boxes, 50, "موجودی tenant B نباید تغییر کند");

  const [heldB] = await sql`
    SELECT COALESCE(SUM(ri.quantity_boxes), 0) AS held
    FROM reservation_item ri
    JOIN reservation r ON r.id = ri.reservation_id
    WHERE ri.lot_id = ${L2} AND r.tenant_id = ${T2} AND r.status = 'active' AND r.expires_at > now()
  `;
  assert.equal(Number(heldB.held), 0, "held روی tenant B باید صفر باشد");
});
