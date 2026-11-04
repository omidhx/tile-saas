import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql, resetSchema } from "./_testdb";
import { reserve } from "./reservations";
import { withTenant } from "./client";
import { T, seedTenant } from "./_fixtures";

// قانون ۱: held فقط رزروهای active با expires_at > now() است؛ رزروِ منقضی حتی قبل از اجرای worker
// انقضا نباید موجودی را نگه دارد. هم مسیر رزرو و هم view را پوشش می‌دهد، چون جدا محاسبه می‌کنند.

const AG = "a5555555-5555-5555-5555-555555555555";
const LOT = "a4444444-4444-4444-4444-444444444444";
const OLD = "a6666666-6666-6666-6666-666666666666";

before(async () => {
  await resetSchema();
  await seedTenant();
  await sql.unsafe(`
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','P1');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('a2222222-2222-2222-2222-222222222222','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('a3333333-3333-3333-3333-333333333333','${T}','W','W1','main');
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES ('${LOT}','${T}','a2222222-2222-2222-2222-222222222222','a3333333-3333-3333-3333-333333333333');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT}',10);
  `);
});

/** رزرو active برای کل موجودی؛ منقضی یا زنده. */
const seedHold = async (expired: boolean) => {
  await sql`DELETE FROM reservation_item`;
  await sql`DELETE FROM reservation`;
  await sql.unsafe(`
    INSERT INTO reservation (id,tenant_id,agent_account_id,created_at,expires_at) VALUES
      ('${OLD}','${T}','${AG}', now() - interval '2 days', now() + interval '${expired ? "-1 day" : "1 day"}');
    INSERT INTO reservation_item (tenant_id,reservation_id,lot_id,quantity_boxes) VALUES ('${T}','${OLD}','${LOT}',10);
  `);
};

const viewRow = () => withTenant(T, async (tx) => {
  const [row] = await tx<{ held_qty_boxes: number; available_qty_boxes: number }[]>`
    SELECT held_qty_boxes, available_qty_boxes FROM v_lot_availability WHERE lot_id = ${LOT}`;
  return row;
});

const tryReserve = (key: string) =>
  reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: key, items: [{ lotId: LOT, quantityBoxes: 10 }] });

beforeEach(async () => { await seedHold(true); });

test("view: رزرو منقضی در held و available حساب نمی‌شود", async () => {
  assert.deepEqual({ ...await viewRow() }, { held_qty_boxes: 0, available_qty_boxes: 10 });
});

test("view: رزرو زنده در held و available حساب می‌شود", async () => {
  await seedHold(false);
  assert.deepEqual({ ...await viewRow() }, { held_qty_boxes: 10, available_qty_boxes: 0 });
});

test("reserve: موجودی آزادشده از رزرو منقضی دوباره قابل رزرو است", async () => {
  const r = await tryReserve("after-expiry");
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("reserve: رزرو زنده هنوز جلوی oversell را می‌گیرد", async () => {
  await seedHold(false);
  const r = await tryReserve("while-live");
  assert.equal(r.ok, false);
});
