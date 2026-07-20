import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { reserve, cancelReservation } from "./reservations";

const T = "11111111-1111-1111-1111-111111111111";
const U = "a8888888-8888-8888-8888-888888888888";
const AG = "a5555555-5555-5555-5555-555555555555";
const AG2 = "a6666666-6666-6666-6666-666666666666"; // نمایندگی دیگر
const VAR = "a2222222-2222-2222-2222-222222222222";
const LOT = "a4444444-4444-4444-4444-444444444444";

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','0910','x');
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1'), ('${AG2}','${T}','Ag2','AG2');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','P1');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${VAR}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('a3333333-3333-3333-3333-333333333333','${T}','W','W1','main');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES ('${LOT}','${T}','${VAR}','a3333333-3333-3333-3333-333333333333');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT}',100);
  `);
});
after(async () => { await sql.end(); });

const available = async () =>
  Number((await sql<{ v: number }[]>`SELECT available_qty_boxes AS v FROM v_lot_availability WHERE lot_id = ${LOT}`)[0].v);

test("لغو رزرو موجودی را بلافاصله آزاد می‌کند (held محاسباتی است)", async () => {
  assert.equal(await available(), 100);
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "c1", items: [{ lotId: LOT, quantityBoxes: 40 }] });
  assert.equal(r.ok, true);
  assert.equal(await available(), 60, "رزرو باید ۴۰ را نگه دارد");

  const c = await cancelReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U, agentAccountId: AG });
  assert.equal(c.ok, true);
  assert.equal(await available(), 100, "بعد از لغو، موجودی فوراً برمی‌گردد — بدون منتظرِ worker ماندن");

  const [resv] = await sql<{ status: string }[]>`SELECT status FROM reservation WHERE id = ${r.ok ? r.reservationId : ""}`;
  assert.equal(resv.status, "cancelled");
});

test("لغو دوباره → not_active (بدون آزادسازیِ دوباره)", async () => {
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "c2", items: [{ lotId: LOT, quantityBoxes: 10 }] });
  const id = r.ok ? r.reservationId : "";
  assert.equal((await cancelReservation({ tenantId: T, reservationId: id, actorUserId: U })).ok, true);

  const again = await cancelReservation({ tenantId: T, reservationId: id, actorUserId: U });
  assert.equal(again.ok, false);
  assert.equal(!again.ok && again.reason, "not_active");
  assert.equal(await available(), 100, "موجودی نباید دوباره تغییر کند");
});

test("نماینده نمی‌تواند رزروِ نمایندگیِ دیگر را لغو کند", async () => {
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "c3", items: [{ lotId: LOT, quantityBoxes: 5 }] });
  const id = r.ok ? r.reservationId : "";

  // AG2 ادعای لغوِ رزروِ AG را دارد
  const bad = await cancelReservation({ tenantId: T, reservationId: id, actorUserId: U, agentAccountId: AG2 });
  assert.equal(bad.ok, false);
  assert.equal(!bad.ok && bad.reason, "not_found", "نباید حتی وجودش را لو بدهد");
  assert.equal(await available(), 95, "رزرو دست‌نخورده باقی می‌ماند");

  // پشتیبان (بدون agentAccountId) می‌تواند
  assert.equal((await cancelReservation({ tenantId: T, reservationId: id, actorUserId: U })).ok, true);
  assert.equal(await available(), 100);
});
