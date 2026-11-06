import { test } from "node:test";
import assert from "node:assert/strict";
import { sql, resetSchema } from "./_testdb";
import { listCustomers } from "./customers";

// UUID‌های ثابت برای تست
const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const P1 = "e1111111-1111-1111-1111-111111111111";
const P2 = "e2222222-2222-2222-2222-222222222222";

// قواعد خودِ RLS در appRole.test.ts است. اینجا لایه‌ی دوم: فیلتر صریح tenant_id در کد باید
// بدون RLS هم کافی باشد (قانون ۶ هر دو لایه را می‌خواهد؛ یکی نباید خرابی دیگری را پنهان کند).
test("cross-tenant: listCustomers با RLS خاموش هم فقط مشتریان همان tenant را برمی‌گرداند", async () => {
  await resetSchema();
  await sql`INSERT INTO tenant (id, name, slug) VALUES (${T1}, 'T1', 't1'), (${T2}, 'T2', 't2')`;
  await sql`INSERT INTO customer (tenant_id, name) VALUES (${T1}, 'C-T1'), (${T2}, 'C-T2')`;
  await sql`ALTER TABLE customer DISABLE ROW LEVEL SECURITY`;

  const { items } = await listCustomers({ tenantId: T1 });
  assert.deepEqual(items.map((c) => c.name), ["C-T1"]);
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

test("فاز ۴: listMovements و findDrift با RLS خاموش هم فقط همان tenant را برمی‌گردانند", async () => {
  await resetSchema();
  const { listMovements, findDrift } = await import("./ledger");
  for (const [t, n] of [[T1, "1"], [T2, "2"]] as const) {
    await sql.unsafe(`
      INSERT INTO tenant (id, name, slug) VALUES ('${t}', 'T${n}', 't${n}');
      INSERT INTO product (id, tenant_id, code, name) VALUES ('e${n}111111-1111-1111-1111-111111111111', '${t}', 'P${n}', 'کالای ${n}');
      INSERT INTO product_variant (id, tenant_id, product_id, sku) VALUES ('f${n}111111-1111-1111-1111-111111111111', '${t}', 'e${n}111111-1111-1111-1111-111111111111', 'S${n}');
      INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES ('d${n}111111-1111-1111-1111-111111111111', '${t}', 'W', 'W${n}', 'main');
      INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id) VALUES ('c${n}111111-1111-1111-1111-111111111111', '${t}', 'f${n}111111-1111-1111-1111-111111111111', 'd${n}111111-1111-1111-1111-111111111111');
      -- عمداً ناتراز: balance ۵ ولی لجر ۰، تا findDrift ردیفی برگرداند
      INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES ('${t}', 'c${n}111111-1111-1111-1111-111111111111', 5);
      INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes)
        VALUES ('${t}', 'c${n}111111-1111-1111-1111-111111111111', 'adjustment', 0);
    `);
  }
  for (const table of ["inventory_transaction", "inventory_lot", "inventory_balance", "product_variant", "product"])
    await sql.unsafe(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);

  const { items } = await listMovements({ tenantId: T1 });
  assert.deepEqual(items.map((m) => m.code), ["P1"]);
  const drift = await findDrift(T1);
  assert.deepEqual(drift.map((d) => d.code), ["P1"]);
});
