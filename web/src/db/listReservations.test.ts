import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { T, U, seedTenantUser } from "./_fixtures";
import { reserve, listReservations } from "./reservations";
import { approveReservation } from "./salesRequests";

/**
 * فیلدهای «مبلغِ خرید» در listReservations — قفلِ اصلی: تا رزرو تأیید نشده،
 * فقط برآورد (estimatedValue) داریم؛ بعدِ تأیید، مبلغِ قطعیِ snapshot (purchaseValue).
 */

const AG = "a5555555-5555-5555-5555-555555555555";
const PL = "aaaa1111-1111-1111-1111-111111111111";
const V = "a2222222-2222-2222-2222-222222222222";
const WH = "a3333333-3333-3333-3333-333333333333";
const LOT = "a4444444-4444-4444-4444-444444444444";

before(async () => {
  await resetSchema();
  await seedTenantUser();
  await sql.unsafe(`
    INSERT INTO price_list (id,tenant_id,name) VALUES ('${PL}','${T}','لیست');
    INSERT INTO agent_account (id,tenant_id,legal_name,code,price_list_id) VALUES ('${AG}','${T}','Ag','AG1','${PL}');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','W','W1','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','کاشیِ تست');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${V}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES ('${LOT}','${T}','${V}','${WH}');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT}',100);
    INSERT INTO price_list_item (tenant_id,price_list_id,variant_id,price) VALUES ('${T}','${PL}','${V}',1000000);
  `);
});
after(async () => { await sql.end(); });

test("رزروِ active: بدونِ purchaseValue، با estimatedValue از قیمتِ زنده", async () => {
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "k1", items: [{ lotId: LOT, quantityBoxes: 10 }] });
  assert.ok(r.ok);

  const rows = await listReservations({ tenantId: T, agentAccountId: AG });
  const row = rows.find((x) => x.id === (r.ok ? r.reservationId : ""));
  assert.equal(row?.status, "active");
  assert.equal(row?.purchaseValue, null, "هنوز تأیید نشده — مبلغِ قطعی وجود ندارد");
  assert.equal(row?.estimatedValue, 10 * 1_000_000, "۱۰ کارتن × ۱٬۰۰۰٬۰۰۰ ریال");
});

test("بعدِ تأیید: purchaseValue همان snapshotِ قطعی است، estimatedValue دیگر لازم نیست", async () => {
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "k2", items: [{ lotId: LOT, quantityBoxes: 5 }] });
  assert.ok(r.ok);
  const reservationId = r.ok ? r.reservationId : "";
  const approved = await approveReservation({ tenantId: T, reservationId, actorUserId: U });
  assert.ok(approved.ok);

  const rows = await listReservations({ tenantId: T, agentAccountId: AG });
  const row = rows.find((x) => x.id === reservationId);
  assert.equal(row?.status, "converted");
  assert.equal(row?.purchaseValue, 5 * 1_000_000, "۵ کارتن × ۱٬۰۰۰٬۰۰۰ ریال، بدونِ تخفیف");
  assert.equal(row?.estimatedValue, null, "converted دیگر «برآورد» نیست");
});

test("صفِ staff (بدونِ agentAccountId) هیچ‌کدام را محاسبه نمی‌کند — فقط برای «رزروهای من» است", async () => {
  const rows = await listReservations({ tenantId: T });
  assert.ok(rows.every((r) => r.estimatedValue === null));
});
