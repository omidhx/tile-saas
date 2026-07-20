import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { reserve } from "./reservations";
import { approveReservation } from "./salesRequests";
import { createDispatchFromRequest, setDispatchStatus } from "./dispatches";
import { buildReports } from "./reports";

const T = "11111111-1111-1111-1111-111111111111";
const U = "a8888888-8888-8888-8888-888888888888";
const AG = "a5555555-5555-5555-5555-555555555555";
const PL = "aaaa1111-1111-1111-1111-111111111111";
const WH = "a3333333-3333-3333-3333-333333333333";
const V_HOT = "a2222222-2222-2222-2222-222222222222";   // فروخته می‌شود
const V_DEAD = "a2222222-2222-2222-2222-222222222223";  // موجودی دارد، فروش ندارد
const LOT_HOT = "a4444444-4444-4444-4444-444444444444";
const LOT_DEAD = "a4444444-4444-4444-4444-444444444445";

const range = () => ({ from: new Date(Date.now() - 7 * 86400000), to: new Date(Date.now() + 86400000) });

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','0910','x');
    INSERT INTO price_list (id,tenant_id,name) VALUES ('${PL}','${T}','L');
    INSERT INTO agent_account (id,tenant_id,legal_name,code,price_list_id) VALUES ('${AG}','${T}','نمایندگی الف','AG1','${PL}');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','W','W1','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES
      ('a1111111-1111-1111-1111-111111111111','${T}','HOT','پرفروش'),
      ('a1111111-1111-1111-1111-111111111112','${T}','DEAD','راکد');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES
      ('${V_HOT}','${T}','a1111111-1111-1111-1111-111111111111','S-HOT'),
      ('${V_DEAD}','${T}','a1111111-1111-1111-1111-111111111112','S-DEAD');
    INSERT INTO price_list_item (tenant_id,price_list_id,variant_id,price) VALUES ('${T}','${PL}','${V_HOT}',1000000);
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES
      ('${LOT_HOT}','${T}','${V_HOT}','${WH}'), ('${LOT_DEAD}','${T}','${V_DEAD}','${WH}');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES
      ('${T}','${LOT_HOT}',100), ('${T}','${LOT_DEAD}',75);
  `);

  // یک چرخه‌ی کامل: رزرو ۲۰ → تأیید (قیمت ۱٬۰۰۰٬۰۰۰) → حواله → بارگیری
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "rep-1", items: [{ lotId: LOT_HOT, quantityBoxes: 20 }] });
  const a = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  const d = await createDispatchFromRequest({ tenantId: T, salesRequestId: a.ok ? a.salesRequestId : "", createdByUserId: U, dispatchCode: "D-R1" });
  const did = d.ok ? d.dispatchIds[0] : "";
  await setDispatchStatus({ tenantId: T, dispatchId: did, toStatus: "ready_for_loading", actorUserId: U });
  await setDispatchStatus({ tenantId: T, dispatchId: did, toStatus: "loaded", actorUserId: U });
});
after(async () => { await sql.end(); });

test("عملکرد نماینده: تعداد، کارتن، و ارزشِ ریالی از قیمتِ snapshot", async () => {
  const rep = await buildReports({ tenantId: T, ...range() });
  assert.equal(rep.agents.length, 1);
  const a = rep.agents[0];
  assert.equal(a.agentName, "نمایندگی الف");
  assert.equal(a.requests, 1);
  assert.equal(a.boxes, 20);
  assert.equal(a.value, 20_000_000, "۲۰ کارتن × ۱٬۰۰۰٬۰۰۰ ریال");
});

test("پرفروش‌ها از لجرِ بارگیری می‌آید (حقیقتِ فیزیکی، نه سفارش)", async () => {
  const rep = await buildReports({ tenantId: T, ...range() });
  assert.equal(rep.topProducts.length, 1, "فقط کالایی که واقعاً بارگیری شد");
  assert.equal(rep.topProducts[0].code, "HOT");
  assert.equal(rep.topProducts[0].boxes, 20);
});

test("راکد: موجودی دارد ولی در بازه هیچ بارگیری نداشته", async () => {
  const rep = await buildReports({ tenantId: T, ...range() });
  const codes = rep.deadStock.map((d) => d.code);
  assert.ok(codes.includes("DEAD"), "کالای بدون فروش باید راکد باشد");
  assert.equal(rep.deadStock.find((d) => d.code === "DEAD")!.onHand, 75);
  assert.ok(!codes.includes("HOT"), "کالایی که فروش داشته راکد نیست");
});

test("خطِ بدون قیمت شمرده می‌شود — «۰ ریال» با «قیمت ثبت نشده» یکی گزارش نمی‌شود", async () => {
  const before = await buildReports({ tenantId: T, ...range() });
  assert.equal(before.agents[0].unpricedLines, 0, "همه‌ی خط‌ها قیمت دارند");

  // شبیه‌سازیِ سفارشِ قدیمی/بدون قیمت (مثل ردیف‌های قبل از افزودن snapshot)
  await sql`UPDATE sales_request_item SET unit_price_applied = NULL WHERE tenant_id = ${T}`;
  const after = await buildReports({ tenantId: T, ...range() });
  assert.equal(after.agents[0].unpricedLines, 1, "خطِ بی‌قیمت باید شمرده شود");
  assert.equal(after.agents[0].value, 0, "ارزش صفر می‌شود، ولی حالا دلیلش معلوم است");

  await sql`UPDATE sales_request_item SET unit_price_applied = 1000000 WHERE tenant_id = ${T}`;
});

test("بازه‌ی زمانی واقعاً فیلتر می‌کند — بازه‌ی گذشته خالی است", async () => {
  const rep = await buildReports({
    tenantId: T,
    from: new Date(Date.now() - 90 * 86400000),
    to: new Date(Date.now() - 60 * 86400000),
  });
  assert.equal(rep.agents.length, 0, "خارج از بازه نباید فروشی گزارش شود");
  assert.equal(rep.topProducts.length, 0);
  // ولی راکد در آن بازه شاملِ هر دو است، چون هیچ‌کدام در آن بازه بارگیری نشده‌اند
  assert.equal(rep.deadStock.length, 2);
});
