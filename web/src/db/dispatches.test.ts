import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { reserve } from "./reservations";
import { approveReservation } from "./salesRequests";
import { createDispatchFromRequest, setDispatchStatus } from "./dispatches";

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

const bal = async () =>
  (await sql<{ on_hand: number; allocated: number }[]>`
    SELECT on_hand_qty_boxes AS on_hand, allocated_qty_boxes AS allocated FROM inventory_balance WHERE lot_id = ${LOT}`)[0];

// reserve → approve → createDispatch؛ dispatchId را برمی‌گرداند
async function chainToDispatch(key: string, qty: number, code: string): Promise<string> {
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: key, items: [{ lotId: LOT, quantityBoxes: qty }] });
  const a = await approveReservation({ tenantId: T, agentAccountId: AG, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  const d = await createDispatchFromRequest({ tenantId: T, salesRequestId: a.ok ? a.salesRequestId : "", createdByUserId: U, dispatchCode: code });
  assert.equal(d.ok, true, "createDispatch باید موفق شه");
  return d.ok ? d.dispatchId : "";
}

test("loaded: on_hand و allocated هر دو اتمیک کم می‌شن", async () => {
  const before = await bal(); // on_hand 100, allocated 0
  const dispatch = await chainToDispatch("d1", 10, "D-1");
  assert.equal((await bal()).allocated, before.allocated + 10, "approve باید allocated را ۱۰ بالا ببره");

  assert.equal((await setDispatchStatus({ tenantId: T, dispatchId: dispatch, toStatus: "ready_for_loading", actorUserId: U })).ok, true);
  const loaded = await setDispatchStatus({ tenantId: T, dispatchId: dispatch, toStatus: "loaded", actorUserId: U });
  assert.equal(loaded.ok, true);

  const after = await bal();
  assert.equal(after.on_hand, before.on_hand - 10, "on_hand باید ۱۰ کم شه (بارگیری فیزیکی)");
  assert.equal(after.allocated, before.allocated, "allocated باید به حالت اولش برگرده (۱۰ رفت روی جنسِ بارگیری‌شده)");

  // loaded → delivered مجاز
  assert.equal((await setDispatchStatus({ tenantId: T, dispatchId: dispatch, toStatus: "delivered", actorUserId: U })).ok, true);
});

test("guard: بارگیریِ دوباره → invalid_transition، بدون double-decrement", async () => {
  const dispatch = await chainToDispatch("d2", 5, "D-2");
  await setDispatchStatus({ tenantId: T, dispatchId: dispatch, toStatus: "ready_for_loading", actorUserId: U });
  await setDispatchStatus({ tenantId: T, dispatchId: dispatch, toStatus: "loaded", actorUserId: U });
  const onHandAfterLoad = (await bal()).on_hand;

  const again = await setDispatchStatus({ tenantId: T, dispatchId: dispatch, toStatus: "loaded", actorUserId: U });
  assert.equal(again.ok, false);
  assert.equal(!again.ok && again.reason, "invalid_transition");
  assert.equal((await bal()).on_hand, onHandAfterLoad, "on_hand نباید دوباره کم شه");

  // loaded → cancelled ممنوع
  const cancel = await setDispatchStatus({ tenantId: T, dispatchId: dispatch, toStatus: "cancelled", actorUserId: U });
  assert.equal(!cancel.ok && cancel.reason, "invalid_transition");
});

test("cancel قبل از بارگیری: allocated آزاد می‌شه، on_hand دست‌نخورده، request هم cancelled", async () => {
  const before = await bal();
  const dispatch = await chainToDispatch("d3", 7, "D-3");
  assert.equal((await bal()).allocated, before.allocated + 7);

  const cancelled = await setDispatchStatus({ tenantId: T, dispatchId: dispatch, toStatus: "cancelled", actorUserId: U });
  assert.equal(cancelled.ok, true);

  const after = await bal();
  assert.equal(after.allocated, before.allocated, "allocated باید آزاد شه (برگرده به قبل)");
  assert.equal(after.on_hand, before.on_hand, "on_hand نباید تغییر کنه");

  const [req] = await sql<{ status: string }[]>`
    SELECT sr.status FROM sales_request sr
    JOIN sales_dispatch sd ON sd.sales_request_id = sr.id WHERE sd.id = ${dispatch}`;
  assert.equal(req.status, "cancelled", "request مرتبط هم باید cancelled شه");
});
