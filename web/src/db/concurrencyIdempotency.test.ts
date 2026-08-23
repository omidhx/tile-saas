// =============================================================================
// web/src/db/concurrencyIdempotency.test.ts
// =============================================================================
// تستِ concurrency برای idempotency روی PostgreSQL واقعی.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { sql, resetSchema } from "./_testdb";
import { reserve } from "./reservations";

// UUID‌های ثابت برای تست
const T1 = "11111111-1111-1111-1111-111111111111";
const U1 = "a8888888-8888-8888-8888-888888888888";
const M1 = "b1111111-1111-1111-1111-111111111111";
const A1 = "c1111111-1111-1111-1111-111111111111";
const AU1 = "d1111111-1111-1111-1111-111111111111";
const P1 = "e1111111-1111-1111-1111-111111111111";
const V1 = "f1111111-1111-1111-1111-111111111111";
const W1 = "11111112-1111-1111-1111-111111111111";
const L1 = "21111111-1111-1111-1111-111111111111";

async function seedTenantForReservations() {
  await sql`INSERT INTO tenant (id, name, slug) VALUES (${T1}, 'T1', 't1')`;
  await sql`INSERT INTO app_user (id, phone, password_hash) VALUES (${U1}, '09120000000', 'x')`;
  await sql`INSERT INTO tenant_membership (id, tenant_id, user_id, role) VALUES (${M1}, ${T1}, ${U1}, 'agent')`;
  await sql`INSERT INTO agent_account (id, tenant_id, legal_name, code) VALUES (${A1}, ${T1}, 'Agent', 'AG1')`;
  await sql`INSERT INTO agent_account_user (id, tenant_id, agent_account_id, user_id, role) VALUES (${AU1}, ${T1}, ${A1}, ${U1}, 'agent')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES (${P1}, ${T1}, 'P1', 'Product')`;
  await sql`INSERT INTO product_variant (id, tenant_id, product_id, sku) VALUES (${V1}, ${T1}, ${P1}, 'SKU1')`;
  await sql`INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES (${W1}, ${T1}, 'Main', 'W1', 'main')`;
  await sql`INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id) VALUES (${L1}, ${T1}, ${V1}, ${W1})`;
  await sql`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES (${T1}, ${L1}, 100)`;
}

test("idempotency: دو رزرو هم‌زمان با key و payload یکسان → یکی dedupe", async () => {
  await resetSchema();
  await seedTenantForReservations();

  const idempotencyKey = "test-key-" + Date.now();
  const items = [{ lotId: L1, quantityBoxes: 5 }];

  const [r1, r2] = await Promise.all([
    reserve({ tenantId: T1, agentAccountId: A1, ttlHours: 24, idempotencyKey, items }),
    reserve({ tenantId: T1, agentAccountId: A1, ttlHours: 24, idempotencyKey, items }),
  ]);

  assert.ok(r1.ok || r2.ok, "حداقل یکی باید موفق شود");
  if (r2.ok && "deduped" in r2) {
    assert.equal(r2.deduped, true, "دومی باید deduped باشد");
  }

  const reservations = await sql`SELECT id FROM reservation WHERE tenant_id = ${T1} AND idempotency_key = ${idempotencyKey}`;
  assert.equal(reservations.length, 1, "فقط یک رزرو باید ایجاد شود");
});

test("idempotency: key یکسان + payload متفاوت → 409 mismatch", async () => {
  await resetSchema();
  await seedTenantForReservations();

  const idempotencyKey = "test-mismatch-" + Date.now();

  const r1 = await reserve({
    tenantId: T1, agentAccountId: A1, ttlHours: 24, idempotencyKey,
    items: [{ lotId: L1, quantityBoxes: 5 }],
  });
  assert.ok(r1.ok);

  const r2 = await reserve({
    tenantId: T1, agentAccountId: A1, ttlHours: 24, idempotencyKey,
    items: [{ lotId: L1, quantityBoxes: 10 }],
  });
  assert.ok(!r2.ok);
  assert.ok("idempotencyMismatch" in r2, "باید idempotencyMismatch باشد");
});

test("idempotency: retry پس از timeout → 200 dedupe", async () => {
  await resetSchema();
  await seedTenantForReservations();

  const idempotencyKey = "test-retry-" + Date.now();
  const items = [{ lotId: L1, quantityBoxes: 5 }];

  const r1 = await reserve({ tenantId: T1, agentAccountId: A1, ttlHours: 24, idempotencyKey, items });
  assert.ok(r1.ok);

  const r2 = await reserve({ tenantId: T1, agentAccountId: A1, ttlHours: 24, idempotencyKey, items });
  assert.ok(r2.ok);
  assert.ok("deduped" in r2 && r2.deduped, "باید deduped باشد");
});

test("concurrency: رزرو دوم وقتی موجودی کافی نیست → conflict", async () => {
  await resetSchema();
  await seedTenantForReservations();

  // رزرو اول: 8 کارتن (موجودی 100، held=8، available=92)
  const r1 = await reserve({
    tenantId: T1, agentAccountId: A1, ttlHours: 24,
    idempotencyKey: "key1-" + Date.now(),
    items: [{ lotId: L1, quantityBoxes: 8 }],
  });
  assert.ok(r1.ok && !("idempotencyMismatch" in r1), "اولی باید موفق شود");

  // رزرو دوم: 95 کارتن (available=92 < 95 → conflict)
  const r2 = await reserve({
    tenantId: T1, agentAccountId: A1, ttlHours: 24,
    idempotencyKey: "key2-" + Date.now(),
    items: [{ lotId: L1, quantityBoxes: 95 }],
  });
  assert.ok(!r2.ok, "دومی باید fail شود");
  assert.ok("conflict" in r2, "باید conflict باشد نه mismatch");
});
