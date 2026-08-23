// =============================================================================
// web/src/db/concurrencyIdempotency.test.ts
// =============================================================================
// تستِ concurrency برای idempotency روی PostgreSQL واقعی.
//
// ⚠️ این تست نیاز به PostgreSQL 16 دارد. در محیط فعلی (بدون PostgreSQL)
// اجرا نمی‌شود — در CI با PostgreSQL 16 داکری اجرا می‌شود.
//
// سناریوها:
//   ۱. دو client هم‌زمان با key و payload یکسان → فقط یک رزرو، دومي dedupe (200)
//   ۲. دو client هم‌زمان با key یکسان و payload متفاوت → دومي 409 mismatch
//   ۳. retry پس از timeout → 200 dedupe
//   ۴. دو رزرو هم‌زمان روی یک lot → یکی موفق، دیگری 409 conflict (موجودی کم)
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { sql, resetSchema } from "./_testdb";
import { reserve } from "./reservations";

// این تست‌ها فقط وقتی اجرا می‌شوند که DATABASE_URL به PostgreSQL وصل باشد.
// در CI، این خودکار است.

test("idempotency: دو رزرو هم‌زمان با key و payload یکسان → یکی dedupe", async () => {
  await resetSchema();

  // seed: یک tenant، agent، lot با موجودی
  await sql`INSERT INTO tenant (id, name, slug) VALUES ('t1', 'T1', 't1')`;
  await sql`INSERT INTO app_user (id, phone, password_hash) VALUES ('u1', '09120000000', 'x')`;
  await sql`INSERT INTO tenant_membership (id, tenant_id, user_id, role) VALUES ('m1', 't1', 'u1', 'agent')`;
  await sql`INSERT INTO agent_account (id, tenant_id, legal_name, code) VALUES ('a1', 't1', 'Agent', 'AG1')`;
  await sql`INSERT INTO agent_account_user (id, tenant_id, agent_account_id, user_id, role) VALUES ('au1', 't1', 'a1', 'u1', 'agent')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES ('p1', 't1', 'P1', 'Product')`;
  await sql`INSERT INTO product_variant (id, tenant_id, product_id, sku) VALUES ('v1', 't1', 'p1', 'SKU1')`;
  await sql`INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES ('w1', 't1', 'Main', 'W1', 'main')`;
  await sql`INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id) VALUES ('l1', 't1', 'v1', 'w1')`;
  await sql`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES ('t1', 'l1', 100)`;

  const idempotencyKey = "test-key-" + Date.now();
  const items = [{ lotId: "l1", quantityBoxes: 5 }];

  // دو رزرو هم‌زمان
  const [r1, r2] = await Promise.all([
    reserve({ tenantId: "t1", agentAccountId: "a1", ttlHours: 24, idempotencyKey, items }),
    reserve({ tenantId: "t1", agentAccountId: "a1", ttlHours: 24, idempotencyKey, items }),
  ]);

  // یکی باید موفق باشد و دیگری dedupe
  assert.ok(r1.ok || r2.ok, "حداقل یکی باید موفق شود");
  if (r1.ok && !("idempotencyMismatch" in r1)) {
    assert.equal("deduped" in r1 ? r1.deduped : false, false, "اولی نباید deduped باشد");
  }
  if (r2.ok && "deduped" in r2) {
    assert.equal(r2.deduped, true, "دومی باید deduped باشد");
  }

  // فقط یک رزرو در DB باید باشد
  const reservations = await sql`SELECT id FROM reservation WHERE tenant_id = 't1' AND idempotency_key = ${idempotencyKey}`;
  assert.equal(reservations.length, 1, "فقط یک رزرو باید ایجاد شود");
});

test("idempotency: key یکسان + payload متفاوت → 409 mismatch", async () => {
  await resetSchema();

  await sql`INSERT INTO tenant (id, name, slug) VALUES ('t1', 'T1', 't1')`;
  await sql`INSERT INTO app_user (id, phone, password_hash) VALUES ('u1', '09120000000', 'x')`;
  await sql`INSERT INTO tenant_membership (id, tenant_id, user_id, role) VALUES ('m1', 't1', 'u1', 'agent')`;
  await sql`INSERT INTO agent_account (id, tenant_id, legal_name, code) VALUES ('a1', 't1', 'Agent', 'AG1')`;
  await sql`INSERT INTO agent_account_user (id, tenant_id, agent_account_id, user_id, role) VALUES ('au1', 't1', 'a1', 'u1', 'agent')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES ('p1', 't1', 'P1', 'Product')`;
  await sql`INSERT INTO product_variant (id, tenant_id, product_id, sku) VALUES ('v1', 't1', 'p1', 'SKU1')`;
  await sql`INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES ('w1', 't1', 'Main', 'W1', 'main')`;
  await sql`INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id) VALUES ('l1', 't1', 'v1', 'w1')`;
  await sql`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES ('t1', 'l1', 100)`;

  const idempotencyKey = "test-mismatch-" + Date.now();

  // رزرو اول با 5 کارتن
  const r1 = await reserve({
    tenantId: "t1", agentAccountId: "a1", ttlHours: 24, idempotencyKey,
    items: [{ lotId: "l1", quantityBoxes: 5 }],
  });
  assert.ok(r1.ok);

  // رزرو دوم با همان key ولی 10 کارتن → باید mismatch (409)
  const r2 = await reserve({
    tenantId: "t1", agentAccountId: "a1", ttlHours: 24, idempotencyKey,
    items: [{ lotId: "l1", quantityBoxes: 10 }],
  });
  assert.ok(!r2.ok);
  assert.ok("idempotencyMismatch" in r2, "باید idempotencyMismatch باشد");
});

test("idempotency: retry پس از timeout → 200 dedupe", async () => {
  await resetSchema();

  await sql`INSERT INTO tenant (id, name, slug) VALUES ('t1', 'T1', 't1')`;
  await sql`INSERT INTO app_user (id, phone, password_hash) VALUES ('u1', '09120000000', 'x')`;
  await sql`INSERT INTO tenant_membership (id, tenant_id, user_id, role) VALUES ('m1', 't1', 'u1', 'agent')`;
  await sql`INSERT INTO agent_account (id, tenant_id, legal_name, code) VALUES ('a1', 't1', 'Agent', 'AG1')`;
  await sql`INSERT INTO agent_account_user (id, tenant_id, agent_account_id, user_id, role) VALUES ('au1', 't1', 'a1', 'u1', 'agent')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES ('p1', 't1', 'P1', 'Product')`;
  await sql`INSERT INTO product_variant (id, tenant_id, product_id, sku) VALUES ('v1', 't1', 'p1', 'SKU1')`;
  await sql`INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES ('w1', 't1', 'Main', 'W1', 'main')`;
  await sql`INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id) VALUES ('l1', 't1', 'v1', 'w1')`;
  await sql`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES ('t1', 'l1', 100)`;

  const idempotencyKey = "test-retry-" + Date.now();
  const items = [{ lotId: "l1", quantityBoxes: 5 }];

  // رزرو اول
  const r1 = await reserve({ tenantId: "t1", agentAccountId: "a1", ttlHours: 24, idempotencyKey, items });
  assert.ok(r1.ok);

  // retry با همان key و payload → باید dedupe (200)
  const r2 = await reserve({ tenantId: "t1", agentAccountId: "a1", ttlHours: 24, idempotencyKey, items });
  assert.ok(r2.ok);
  assert.ok("deduped" in r2 && r2.deduped, "باید deduped باشد");
});

test("concurrency: دو رزرو هم‌زمان روی یک lot → یکی موفق، دیگری conflict یا dedupe", async () => {
  await resetSchema();

  await sql`INSERT INTO tenant (id, name, slug) VALUES ('t1', 'T1', 't1')`;
  await sql`INSERT INTO app_user (id, phone, password_hash) VALUES ('u1', '09120000000', 'x')`;
  await sql`INSERT INTO tenant_membership (id, tenant_id, user_id, role) VALUES ('m1', 't1', 'u1', 'agent')`;
  await sql`INSERT INTO agent_account (id, tenant_id, legal_name, code) VALUES ('a1', 't1', 'Agent', 'AG1')`;
  await sql`INSERT INTO agent_account_user (id, tenant_id, agent_account_id, user_id, role) VALUES ('au1', 't1', 'a1', 'u1', 'agent')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES ('p1', 't1', 'P1', 'Product')`;
  await sql`INSERT INTO product_variant (id, tenant_id, product_id, sku) VALUES ('v1', 't1', 'p1', 'SKU1')`;
  await sql`INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES ('w1', 't1', 'Main', 'W1', 'main')`;
  await sql`INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id) VALUES ('l1', 't1', 'v1', 'w1')`;
  await sql`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES ('t1', 'l1', 10)`;

  // دو رزرو هم‌زمان با key‌های مختلف، هر کدام 8 کارتن (موجودی 10)
  // یکی باید موفق، دیگری باید conflict (موجودی کم)
  const [r1, r2] = await Promise.all([
    reserve({
      tenantId: "t1", agentAccountId: "a1", ttlHours: 24,
      idempotencyKey: "key1-" + Date.now(),
      items: [{ lotId: "l1", quantityBoxes: 8 }],
    }),
    reserve({
      tenantId: "t1", agentAccountId: "a1", ttlHours: 24,
      idempotencyKey: "key2-" + Date.now(),
      items: [{ lotId: "l1", quantityBoxes: 8 }],
    }),
  ]);

  // یکی باید موفق، دیگری باید conflict
  const successes = [r1, r2].filter(r => r.ok && !("idempotencyMismatch" in r));
  const conflicts = [r1, r2].filter(r => !r.ok && "conflict" in r);
  assert.equal(successes.length, 1, "فقط یکی باید موفق شود");
  assert.equal(conflicts.length, 1, "دیگری باید conflict شود");
});
