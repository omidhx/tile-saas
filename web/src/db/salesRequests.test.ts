import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { reserve } from "./reservations";
import { approveReservation } from "./salesRequests";
import { T, U, seedTenantUser } from "./_fixtures";

const AG = "a5555555-5555-5555-5555-555555555555";
const VAR = "a2222222-2222-2222-2222-222222222222";
const LOT = "a4444444-4444-4444-4444-444444444444";

before(async () => {
  await resetSchema();
  await seedTenantUser();
  await sql.unsafe(`
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','P1');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${VAR}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('a3333333-3333-3333-3333-333333333333','${T}','W','W1','main');
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES ('${LOT}','${T}','${VAR}','a3333333-3333-3333-3333-333333333333');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT}',100);
  `);
});
after(async () => { await sql.end(); });

const avail = async () =>
  (await sql<{ held: number; allocated: number; available: number }[]>`
    SELECT held_qty_boxes AS held, allocated_qty_boxes AS allocated, available_qty_boxes AS available
    FROM v_lot_availability WHERE lot_id = ${LOT}`)[0];

test("approve: held → allocated بدون گپ، و SalesRequest تأییدشده می‌سازد", async () => {
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "a1", items: [{ lotId: LOT, quantityBoxes: 10 }] });
  assert.equal(r.ok, true);
  const before = await avail();
  assert.equal(before.held, 10);
  assert.equal(before.allocated, 0);
  assert.equal(before.available, 90);

  const res = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  assert.equal(res.ok, true);

  const after = await avail();
  assert.equal(after.held, 0, "held باید صفر شه (رزرو converted)");
  assert.equal(after.allocated, 10, "allocated باید ۱۰ شه");
  assert.equal(after.available, 90, "available بدون گپ ثابت می‌مونه (۹۰ قبل و بعد)");

  const [srq] = await sql<{ status: string }[]>`SELECT status FROM sales_request WHERE id = ${res.ok ? res.salesRequestId : ""}`;
  assert.equal(srq.status, "approved");
  const [alloc] = await sql<{ n: string }[]>`SELECT count(*) AS n FROM sales_request_allocation WHERE lot_id = ${LOT}`;
  assert.equal(Number(alloc.n), 1);
});

test("guard: تأیید دوباره‌ی همان رزرو → not_active (بدون double-allocate)", async () => {
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "a2", items: [{ lotId: LOT, quantityBoxes: 5 }] });
  const first = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  assert.equal(first.ok, true);
  const allocatedAfterFirst = (await avail()).allocated; // 10 + 5 = 15

  const second = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  assert.equal(second.ok, false);
  assert.equal(!second.ok && second.reason, "not_active");
  assert.equal((await avail()).allocated, allocatedAfterFirst, "allocated نباید دوباره بالا بره");
});

test("رزرو ناموجود → not_found", async () => {
  const res = await approveReservation({ tenantId: T, reservationId: "00000000-0000-0000-0000-000000000000", actorUserId: U });
  assert.equal(res.ok, false);
  assert.equal(!res.ok && res.reason, "not_found");
});
