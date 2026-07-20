import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { resolvePrices, applyVolumeDiscount } from "./pricing";
import { reserve } from "./reservations";
import { approveReservation } from "./salesRequests";

const T = "11111111-1111-1111-1111-111111111111";
const AG = "a5555555-5555-5555-5555-555555555555";   // لیست قیمت دارد
const AG2 = "a6666666-6666-6666-6666-666666666666";  // هیچ لیستی ندارد
const PL = "aaaa1111-1111-1111-1111-111111111111";
const V1 = "a2222222-2222-2222-2222-222222222222";
const V2 = "a2222222-2222-2222-2222-222222222223";

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');
    INSERT INTO price_list (id,tenant_id,name) VALUES ('${PL}','${T}','لیست ۱۴۰۵');
    INSERT INTO agent_account (id,tenant_id,legal_name,code,price_list_id) VALUES
      ('${AG}','${T}','Ag','AG1','${PL}'), ('${AG2}','${T}','Ag2','AG2',NULL);
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','P1');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES
      ('${V1}','${T}','a1111111-1111-1111-1111-111111111111','S1'),
      ('${V2}','${T}','a1111111-1111-1111-1111-111111111111','S2');
    -- قیمت لیست: هر کارتن ۱٬۰۰۰٬۰۰۰ ریال
    INSERT INTO price_list_item (tenant_id,price_list_id,variant_id,price) VALUES
      ('${T}','${PL}','${V1}',1000000), ('${T}','${PL}','${V2}',2000000);
  `);
});
after(async () => { await sql.end(); });

test("قیمت از لیستِ نماینده خوانده می‌شود", async () => {
  const p = await resolvePrices({ tenantId: T, agentAccountId: AG, variantIds: [V1, V2] });
  assert.equal(p.get(V1)!.unitPrice, 1000000);
  assert.equal(p.get(V1)!.source, "list");
  assert.equal(p.get(V2)!.unitPrice, 2000000);
});

test("نماینده‌ی بدون لیست قیمت، قیمتی نمی‌گیرد (نه صفر، نه قیمتِ نماینده‌ی دیگر)", async () => {
  const p = await resolvePrices({ tenantId: T, agentAccountId: AG2, variantIds: [V1] });
  assert.equal(p.has(V1), false, "نبودِ قیمت باید «نداریم» باشد، نه ۰");
});

test("override بر لیست ارجح است، ولی فقط در بازه‌ی اعتبار", async () => {
  await sql`
    INSERT INTO agent_price_override (tenant_id,agent_account_id,variant_id,price,valid_from,valid_to)
    VALUES (${T},${AG},${V1},900000, CURRENT_DATE - 1, CURRENT_DATE + 1)`;
  const now = await resolvePrices({ tenantId: T, agentAccountId: AG, variantIds: [V1] });
  assert.equal(now.get(V1)!.unitPrice, 900000);
  assert.equal(now.get(V1)!.source, "override");

  // تاریخِ خارج از بازه → دوباره قیمت لیست
  const later = await resolvePrices({
    tenantId: T, agentAccountId: AG, variantIds: [V1],
    at: new Date(Date.now() + 10 * 24 * 3600 * 1000),
  });
  assert.equal(later.get(V1)!.unitPrice, 1000000);
  assert.equal(later.get(V1)!.source, "list");
});

test("تخفیف حجمی: بهترین پله‌ی واجدشرایط، با ریاضیِ صحیح", async () => {
  await sql`
    INSERT INTO volume_discount (tenant_id,price_list_id,variant_id,min_qty_boxes,percent_off) VALUES
      (${T},${PL},${V2},50,5), (${T},${PL},${V2},100,12)`;

  // زیر پله → بدون تخفیف
  const small = await resolvePrices({ tenantId: T, agentAccountId: AG, variantIds: [V2], qtyByVariant: { [V2]: 10 } });
  assert.equal(small.get(V2)!.percentOff, 0);
  assert.equal(small.get(V2)!.lineTotal, 20000000);

  // بین دو پله → ۵٪
  const mid = await resolvePrices({ tenantId: T, agentAccountId: AG, variantIds: [V2], qtyByVariant: { [V2]: 50 } });
  assert.equal(mid.get(V2)!.percentOff, 5);
  assert.equal(mid.get(V2)!.discountAmount, 5000000);   // 100م × ۵٪
  assert.equal(mid.get(V2)!.lineTotal, 95000000);

  // بالای پله‌ی دوم → بهترین (۱۲٪) نه اولی
  const big = await resolvePrices({ tenantId: T, agentAccountId: AG, variantIds: [V2], qtyByVariant: { [V2]: 100 } });
  assert.equal(big.get(V2)!.percentOff, 12);
  assert.equal(big.get(V2)!.lineTotal, 176000000);
});

test("snapshot: قیمتِ لحظه‌ی تأیید ثبت می‌شود و تغییرِ بعدیِ قیمت آن را بازنویسی نمی‌کند", async () => {
  // موجودی و رزرو برای V1 (قیمت لیست ۱٬۰۰۰٬۰۰۰، override فعال ۹۰۰٬۰۰۰ از تست قبل)
  await sql.unsafe(`
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('a3333333-3333-3333-3333-333333333333','${T}','W','W1','main');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES ('a4444444-4444-4444-4444-444444444444','${T}','${V1}','a3333333-3333-3333-3333-333333333333');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','a4444444-4444-4444-4444-444444444444',100);
    INSERT INTO app_user (id,phone,password_hash) VALUES ('a8888888-8888-8888-8888-888888888888','0910','x');
  `);
  const r = await reserve({
    tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "snap-1",
    items: [{ lotId: "a4444444-4444-4444-4444-444444444444", quantityBoxes: 4 }],
  });
  const a = await approveReservation({
    tenantId: T, reservationId: r.ok ? r.reservationId : "",
    actorUserId: "a8888888-8888-8888-8888-888888888888",
  });
  assert.equal(a.ok, true);

  const [line] = await sql<{ unit: string; cur: string; basis: string; src: string; disc: string }[]>`
    SELECT unit_price_applied AS unit, currency AS cur, price_basis AS basis,
           applied_price_source AS src, discount_amount AS disc
    FROM sales_request_item WHERE request_id = ${a.ok ? a.salesRequestId : ""}`;
  assert.equal(Number(line.unit), 900000, "قیمتِ override لحظه‌ی تأیید");
  assert.equal(line.src, "override");
  assert.equal(line.cur, "IRR");
  assert.equal(line.basis, "per_box");

  // حالا قیمت را عوض می‌کنیم — سفارشِ ثبت‌شده نباید تکان بخورد
  await sql`UPDATE agent_price_override SET price = 111111 WHERE tenant_id = ${T} AND variant_id = ${V1}`;
  const [again] = await sql<{ unit: string }[]>`
    SELECT unit_price_applied AS unit FROM sales_request_item WHERE request_id = ${a.ok ? a.salesRequestId : ""}`;
  assert.equal(Number(again.unit), 900000, "تغییرِ قیمت نباید سفارشِ قبلی را بازنویسی کند");
  await sql`UPDATE agent_price_override SET price = 900000 WHERE tenant_id = ${T} AND variant_id = ${V1}`;
});

test("پول هیچ‌جا float نمی‌شود — تخفیف با floor حساب می‌شود", () => {
  // ۳۳٪ روی ۱۰۰۰ = ۳۳۰ دقیق؛ ۳۳٪ روی ۱۰۰۱ = 330.33 → باید ۳۳۰ شود نه اعشار
  const a = applyVolumeDiscount(1001, 1, 33);
  assert.equal(a.discountAmount, 330);
  assert.equal(a.lineTotal, 671);
  assert.ok(Number.isInteger(a.discountAmount) && Number.isInteger(a.lineTotal));

  const b = applyVolumeDiscount(999999, 7, 13);
  assert.ok(Number.isInteger(b.discountAmount) && Number.isInteger(b.lineTotal));
  assert.equal(b.gross - b.discountAmount, b.lineTotal, "کل = ناخالص منهای تخفیف");
});
