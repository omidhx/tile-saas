import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { reserve } from "./reservations";
import { approveReservation } from "./salesRequests";
import { createDispatchFromRequest, setDispatchStatus } from "./dispatches";

/**
 * چندانباره (v2، spec ۹).
 *
 * چیزی که اینجا تست می‌شود یک فیچر نیست، یک **باگِ خاموش** است: قبلاً یک حواله
 * می‌توانست اقلامی از دو انبار داشته باشد، در حالی که حواله یعنی یک کامیون که در
 * یک نقطه بار می‌زند. انباردار لیستِ برداشتی می‌گرفت که نصفش آنجا نبود.
 */

const T = "11111111-1111-1111-1111-111111111111";
const AG = "a5555555-5555-5555-5555-555555555555";
const U = "a8888888-8888-8888-8888-888888888888";
const V = "a2222222-2222-2222-2222-222222222222";
const WH_A = "a3333333-3333-3333-3333-33333333333a";
const WH_B = "a3333333-3333-3333-3333-33333333333b";
const LOT_A = "a4444444-4444-4444-4444-44444444444a";
const LOT_B = "a4444444-4444-4444-4444-44444444444b";

let seq = 0;
const key = () => `mw-${++seq}`;

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','0910','x');
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','کالا');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${V}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES
      ('${WH_A}','${T}','انبار مرکزی','WA','main'),
      ('${WH_B}','${T}','انبار یزد','WB','regional');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES
      ('${LOT_A}','${T}','${V}','${WH_A}'), ('${LOT_B}','${T}','${V}','${WH_B}');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES
      ('${T}','${LOT_A}',60), ('${T}','${LOT_B}',40);
  `);
});
after(async () => { await sql.end(); });

/** رزرو → تأیید → حواله. آرایه‌ی حواله‌ها را برمی‌گرداند. */
async function chain(items: { lotId: string; quantityBoxes: number }[], code: string) {
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: key(), items });
  assert.ok(r.ok);
  const a = await approveReservation({ tenantId: T, reservationId: r.reservationId, actorUserId: U });
  assert.ok(a.ok);
  const d = await createDispatchFromRequest({
    tenantId: T, salesRequestId: a.salesRequestId, createdByUserId: U, dispatchCode: code,
  });
  assert.ok(d.ok);
  return d.dispatchIds;
}

test("سفارشِ تک‌انباره یک حواله می‌سازد، با کدِ دست‌نخورده", async () => {
  const ids = await chain([{ lotId: LOT_A, quantityBoxes: 10 }], "D-SINGLE");
  assert.equal(ids.length, 1);
  const [d] = await sql<{ dispatch_code: string; warehouse_id: string }[]>`
    SELECT dispatch_code, warehouse_id FROM sales_dispatch WHERE id = ${ids[0]}`;
  assert.equal(d.dispatch_code, "D-SINGLE", "وقتی تقسیم نشده، کد نباید پسوند بگیرد");
  assert.equal(d.warehouse_id, WH_A);
});

test("سفارشِ دوانباره به دو حواله تقسیم می‌شود — هرکدام فقط اقلامِ انبارِ خودش", async () => {
  const ids = await chain(
    [{ lotId: LOT_A, quantityBoxes: 20 }, { lotId: LOT_B, quantityBoxes: 15 }],
    "D-SPLIT",
  );
  assert.equal(ids.length, 2, "یک کامیون نمی‌تواند از دو انبار بار بزند");

  const rows = await sql<{ id: string; dispatch_code: string; warehouse_id: string }[]>`
    SELECT id, dispatch_code, warehouse_id FROM sales_dispatch WHERE id IN ${sql(ids)} ORDER BY dispatch_code`;
  assert.deepEqual(rows.map((r) => r.dispatch_code), ["D-SPLIT-WA", "D-SPLIT-WB"],
    "کد باید با کدِ انبار پسوند بگیرد تا برای انباردار معنادار بماند");

  // هیچ حواله‌ای نباید قلمی از انبارِ دیگر داشته باشد — همان باگی که این فیچر می‌بندد
  for (const r of rows) {
    const items = await sql<{ warehouse_id: string }[]>`
      SELECT warehouse_id FROM sales_dispatch_item WHERE dispatch_id = ${r.id}`;
    assert.ok(items.length > 0);
    assert.ok(items.every((i) => i.warehouse_id === r.warehouse_id),
      `حواله‌ی ${r.dispatch_code} قلمی از انبارِ دیگر دارد`);
  }
});

test("بارگیریِ یک حواله فقط موجودیِ همان انبار را کم می‌کند", async () => {
  const ids = await chain(
    [{ lotId: LOT_A, quantityBoxes: 5 }, { lotId: LOT_B, quantityBoxes: 7 }],
    "D-LOAD",
  );
  const [whA] = await sql<{ id: string }[]>`
    SELECT id FROM sales_dispatch WHERE id IN ${sql(ids)} AND warehouse_id = ${WH_A}`;

  const before = await sql<{ lot_id: string; on_hand: number }[]>`
    SELECT lot_id, on_hand_qty_boxes AS on_hand FROM inventory_balance WHERE tenant_id = ${T} ORDER BY lot_id`;

  await setDispatchStatus({ tenantId: T, dispatchId: whA.id, toStatus: "ready_for_loading", actorUserId: U });
  await setDispatchStatus({ tenantId: T, dispatchId: whA.id, toStatus: "loaded", actorUserId: U });

  const after = await sql<{ lot_id: string; on_hand: number }[]>`
    SELECT lot_id, on_hand_qty_boxes AS on_hand FROM inventory_balance WHERE tenant_id = ${T} ORDER BY lot_id`;

  const deltaOf = (lot: string) =>
    after.find((r) => r.lot_id === lot)!.on_hand - before.find((r) => r.lot_id === lot)!.on_hand;
  assert.equal(deltaOf(LOT_A), -5, "انبارِ بارگیری‌شده کم شد");
  assert.equal(deltaOf(LOT_B), 0, "انبارِ دیگر نباید دست بخورد — بارش هنوز نرفته");
});

test("حواله‌ی backorder انبار ندارد (هنوز lot ندارد)", async () => {
  const { createBackorderDispatch } = await import("./dispatches");
  const d = await createBackorderDispatch({
    tenantId: T, agentAccountId: AG, createdByUserId: U, dispatchCode: "BO-MW",
    items: [{ variantId: V, quantityBoxes: 5 }],
  });
  assert.ok(d.ok);
  const [row] = await sql<{ warehouse_id: string | null }[]>`
    SELECT warehouse_id FROM sales_dispatch WHERE dispatch_code = 'BO-MW'`;
  assert.equal(row.warehouse_id, null, "کالایی که هنوز تولید نشده انبار ندارد — NULL درست است، نه یک انبارِ دلخواه");
});
