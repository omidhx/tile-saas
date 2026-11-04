import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { T, U, seedTenantUser } from "./_fixtures";
import { reserve } from "./reservations";
import { approveReservation } from "./salesRequests";
import { createDispatchFromRequest, setDispatchStatus } from "./dispatches";
import { getDashboardKpis } from "./dashboard";

/**
 * KPIِ صفحه‌ی اولِ پشتیبان. دو قاعده که تست‌ها قفلش می‌کنند:
 *   • «امروز» فقط از `dispatch_load`ِ واقعی می‌آید (نه ساختِ حواله، نه approve).
 *   • «رو به اتمام» یعنی available کم است ولی صفر نیست.
 */

const AG = "a5555555-5555-5555-5555-555555555555";
const WH = "a3333333-3333-3333-3333-333333333333";
const V = "a2222222-2222-2222-2222-222222222222";
const LOT = "a4444444-4444-4444-4444-444444444444";

before(async () => {
  await resetSchema();
  await seedTenantUser();
  await sql.unsafe(`
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','W','W1','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','کاشیِ تست');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${V}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES ('${LOT}','${T}','${V}','${WH}');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT}',100);
  `);
});
after(async () => { await sql.end(); });

test("قبل از هر حرکتی: صفر و بدونِ رو-به-اتمام (موجودی ۱۰۰ بالای آستانه است)", async () => {
  const k = await getDashboardKpis(T);
  assert.equal(k.todayDispatches, 0);
  assert.equal(k.todayBoxes, 0);
  assert.equal(k.lowStock.length, 0);
});

test("reserve/approve/createDispatch به‌تنهایی چیزی به «امروز» اضافه نمی‌کند — فقط loaded", async () => {
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "k1", items: [{ lotId: LOT, quantityBoxes: 95 }] });
  assert.ok(r.ok);
  const a = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  assert.ok(a.ok);
  const d = await createDispatchFromRequest({ tenantId: T, salesRequestId: a.ok ? a.salesRequestId : "", createdByUserId: U, dispatchCode: "D-KPI-1" });
  assert.ok(d.ok);

  const before = await getDashboardKpis(T);
  assert.equal(before.todayDispatches, 0, "هنوز بارگیری نشده — نباید در KPI باشد");
  assert.equal(before.todayBoxes, 0);

  await setDispatchStatus({ tenantId: T, dispatchId: d.ok ? d.dispatchIds[0] : "", toStatus: "ready_for_loading", actorUserId: U });
  await setDispatchStatus({ tenantId: T, dispatchId: d.ok ? d.dispatchIds[0] : "", toStatus: "loaded", actorUserId: U });

  const after = await getDashboardKpis(T);
  assert.equal(after.todayDispatches, 1);
  assert.equal(after.todayBoxes, 95);
  // on_hand از ۱۰۰ به ۵ رسید — زیرِ آستانه‌ی ۱۰، پس باید «رو به اتمام» باشد
  assert.equal(after.lowStock.length, 1);
  assert.equal(after.lowStock[0].variantId, V);
  assert.equal(after.lowStock[0].available, 5);
});
