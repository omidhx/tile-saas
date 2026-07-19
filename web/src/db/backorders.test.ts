import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { createBackorderDispatch, setBackorderItemStatus } from "./dispatches";

const T = "11111111-1111-1111-1111-111111111111";
const AG = "a5555555-5555-5555-5555-555555555555";
const U = "a8888888-8888-8888-8888-888888888888";
const VAR = "a2222222-2222-2222-2222-222222222222";
const LOT = "a4444444-4444-4444-4444-444444444444";

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','0910','x');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','P1');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${VAR}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('a3333333-3333-3333-3333-333333333333','${T}','W','W1','main');
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES ('${LOT}','${T}','${VAR}','a3333333-3333-3333-3333-333333333333');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT}',100);
  `);
});
after(async () => { await sql.end(); });

async function itemIdOf(dispatchId: string) {
  const [row] = await sql<{ id: string; backorder_status: string; lot_id: string | null; fulfillment_type: string }[]>`
    SELECT id, backorder_status, lot_id, fulfillment_type FROM sales_dispatch_item WHERE dispatch_id = ${dispatchId}`;
  return row;
}

test("backorder ساخته می‌شه و هیچ ردیف موجودی/لجری را دست نمی‌زنه", async () => {
  const before = (await sql`SELECT on_hand_qty_boxes, allocated_qty_boxes, blocked_qty_boxes FROM inventory_balance WHERE lot_id = ${LOT}`)[0];
  const txnBefore = Number((await sql`SELECT count(*) AS n FROM inventory_transaction`)[0].n);

  const d = await createBackorderDispatch({
    tenantId: T, agentAccountId: AG, createdByUserId: U, dispatchCode: "BO-1",
    items: [{ variantId: VAR, quantityBoxes: 20 }],
  });
  assert.equal(d.ok, true);

  const item = await itemIdOf(d.ok ? d.dispatchId : "");
  assert.equal(item.fulfillment_type, "backorder");
  assert.equal(item.lot_id, null, "backorder نباید lot داشته باشه");
  assert.equal(item.backorder_status, "pending_production");

  const after = (await sql`SELECT on_hand_qty_boxes, allocated_qty_boxes, blocked_qty_boxes FROM inventory_balance WHERE lot_id = ${LOT}`)[0];
  assert.deepEqual(after, before, "موجودی نباید تغییر کنه — backorder بیرون از محاسبه‌ست");
  const txnAfter = Number((await sql`SELECT count(*) AS n FROM inventory_transaction`)[0].n);
  assert.equal(txnAfter, txnBefore, "backorder نباید لجر موجودی بسازه");
});

test("گذارِ backorder_status: pending_production → ready → fulfilled", async () => {
  const d = await createBackorderDispatch({
    tenantId: T, agentAccountId: AG, createdByUserId: U, dispatchCode: "BO-2",
    items: [{ variantId: VAR, quantityBoxes: 5 }],
  });
  const item = await itemIdOf(d.ok ? d.dispatchId : "");

  assert.equal((await setBackorderItemStatus({ tenantId: T, dispatchItemId: item.id, toStatus: "ready" })).ok, true);
  assert.equal((await setBackorderItemStatus({ tenantId: T, dispatchItemId: item.id, toStatus: "fulfilled" })).ok, true);

  const [after] = await sql<{ backorder_status: string }[]>`SELECT backorder_status FROM sales_dispatch_item WHERE id = ${item.id}`;
  assert.equal(after.backorder_status, "fulfilled");
});

test("guard: گذارِ نامجاز backorder → invalid_transition", async () => {
  const d = await createBackorderDispatch({
    tenantId: T, agentAccountId: AG, createdByUserId: U, dispatchCode: "BO-3",
    items: [{ variantId: VAR, quantityBoxes: 5 }],
  });
  const item = await itemIdOf(d.ok ? d.dispatchId : "");
  // pending_production → fulfilled مجاز نیست (باید اول ready)
  const bad = await setBackorderItemStatus({ tenantId: T, dispatchItemId: item.id, toStatus: "fulfilled" });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.reason, "invalid_transition");
});

test("no_items رد می‌شه", async () => {
  const d = await createBackorderDispatch({ tenantId: T, agentAccountId: AG, createdByUserId: U, dispatchCode: "BO-4", items: [] });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.reason, "no_items");
});
