import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { reserve } from "./reservations";
import { approveReservation } from "./salesRequests";
import { createDispatchFromRequest, setDispatchStatus } from "./dispatches";
import { buildReports, buildMonthlyAgentPerf } from "./reports";
import { toJalali } from "@/lib/date";
import { T, U, seedTenantUser } from "./_fixtures";

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
  await seedTenantUser();
  await sql.unsafe(`
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

test("تخفیف‌های اعمال‌شده به‌تفکیکِ نماینده/کالا: از discount_amountِ snapshot می‌آید", async () => {
  await sql`INSERT INTO volume_discount (tenant_id, price_list_id, variant_id, min_qty_boxes, percent_off) VALUES (${T}, ${PL}, ${V_HOT}, 10, 10)`;
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "disc-1", items: [{ lotId: LOT_HOT, quantityBoxes: 10 }] });
  const a = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  assert.equal(a.ok, true);

  const rep = await buildReports({ tenantId: T, ...range() });
  const agentRow = rep.discountsByAgent.find((d) => d.agentId === AG);
  assert.ok(agentRow, "نماینده باید در فهرستِ تخفیف‌ها باشد");
  assert.equal(agentRow!.discountAmount, 1_000_000, "۱۰٪ روی ۱۰×۱٬۰۰۰٬۰۰۰");
  assert.equal(agentRow!.discountedLines, 1, "فقط همین خطِ تازه تخفیف خورده، خطِ اولِ فیکسچر نه");

  const productRow = rep.discountsByProduct.find((d) => d.code === "HOT");
  assert.ok(productRow, "کالا باید در فهرستِ تخفیف‌ها باشد");
  assert.equal(productRow!.discountAmount, 1_000_000);

  // کالای راکد هیچ سفارشی نداشته، پس نباید در فهرستِ تخفیف‌ها باشد
  assert.ok(!rep.discountsByProduct.some((d) => d.code === "DEAD"));
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

test("فیلترِ نماینده: فقط داده‌ی همان نماینده را می‌دهد، نه جمعِ همه", async () => {
  const AG2 = "a5555555-5555-5555-5555-555555555556";
  await sql.unsafe(`
    INSERT INTO agent_account (id,tenant_id,legal_name,code,price_list_id) VALUES ('${AG2}','${T}','نمایندگی ب','AG2','${PL}');
  `);
  const r = await reserve({ tenantId: T, agentAccountId: AG2, ttlHours: 24, idempotencyKey: "rep-ag2", items: [{ lotId: LOT_HOT, quantityBoxes: 10 }] });
  const a = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  const d = await createDispatchFromRequest({ tenantId: T, salesRequestId: a.ok ? a.salesRequestId : "", createdByUserId: U, dispatchCode: "D-R2" });
  const did = d.ok ? d.dispatchIds[0] : "";
  await setDispatchStatus({ tenantId: T, dispatchId: did, toStatus: "ready_for_loading", actorUserId: U });
  await setDispatchStatus({ tenantId: T, dispatchId: did, toStatus: "loaded", actorUserId: U });

  const unfiltered = await buildReports({ tenantId: T, ...range() });
  assert.equal(unfiltered.agents.length, 2, "بدونِ فیلتر هر دو نماینده باشند");
  assert.equal(unfiltered.topProducts.find((p) => p.code === "HOT")!.boxes, 30, "جمعِ بارگیریِ هر دو نماینده");

  const onlyAg1 = await buildReports({ tenantId: T, ...range(), agentAccountId: AG });
  assert.equal(onlyAg1.agents.length, 1);
  assert.equal(onlyAg1.agents[0].agentId, AG);
  assert.equal(onlyAg1.topProducts.find((p) => p.code === "HOT")!.boxes, 20, "فقط بارگیریِ حواله‌ی همین نماینده، نه نماینده‌ی دیگر");

  const onlyAg2 = await buildReports({ tenantId: T, ...range(), agentAccountId: AG2 });
  assert.equal(onlyAg2.agents.length, 1);
  assert.equal(onlyAg2.agents[0].agentId, AG2);
  assert.equal(onlyAg2.topProducts.find((p) => p.code === "HOT")!.boxes, 10);

  // راکد به نماینده ربطی ندارد — فیلترِ نماینده رویش اثر نمی‌گذارد
  assert.equal(onlyAg1.deadStock.length, unfiltered.deadStock.length);
});

test("فیلترِ کالا: عملکردِ نماینده را به همان یک کالا محدود می‌کند", async () => {
  const onlyDead = await buildReports({ tenantId: T, ...range(), variantId: V_DEAD });
  assert.equal(onlyDead.agents.length, 0, "کسی V_DEAD نخریده، پس با این فیلتر نماینده‌ای دیده نمی‌شود");
  assert.equal(onlyDead.topProducts.length, 0);

  const onlyHot = await buildReports({ tenantId: T, ...range(), variantId: V_HOT });
  assert.ok(onlyHot.agents.length > 0);
  assert.equal(onlyHot.topProducts.length, 1);
  assert.equal(onlyHot.topProducts[0].code, "HOT");
});

test("عملکردِ نماینده به‌تفکیکِ انبار: کارتن به‌درستی بینِ دو انبار تقسیم می‌شود", async () => {
  const WH2 = "a3333333-3333-3333-3333-333333333334";
  const LOT_HOT_WH2 = "a4444444-4444-4444-4444-444444444446";
  await sql.unsafe(`
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH2}','${T}','انبارِ دو','W2','main');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES ('${LOT_HOT_WH2}','${T}','${V_HOT}','${WH2}');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT_HOT_WH2}',50);
  `);
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "wh-test-1", items: [{ lotId: LOT_HOT_WH2, quantityBoxes: 5 }] });
  const a = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  assert.equal(a.ok, true);
  const d = await createDispatchFromRequest({ tenantId: T, salesRequestId: a.ok ? a.salesRequestId : "", createdByUserId: U, dispatchCode: "D-WH2" });
  const did = d.ok ? d.dispatchIds[0] : "";
  await setDispatchStatus({ tenantId: T, dispatchId: did, toStatus: "ready_for_loading", actorUserId: U });
  await setDispatchStatus({ tenantId: T, dispatchId: did, toStatus: "loaded", actorUserId: U });

  const rep = await buildReports({ tenantId: T, ...range() });
  const wh2Idx = rep.warehouseBuckets.findIndex((w) => w.warehouseId === WH2);
  const whIdx = rep.warehouseBuckets.findIndex((w) => w.warehouseId === WH);
  assert.ok(wh2Idx >= 0 && whIdx >= 0, "هر دو انبار باید در فهرستِ باکت‌ها باشند");

  const agRow = rep.agentsByWarehouse.find((r) => r.agentId === AG);
  assert.ok(agRow, "نماینده باید در فهرست باشد");
  assert.equal(agRow!.warehouses[wh2Idx].boxes, 5, "کارتنِ بارگیری‌شده از انبارِ دو");
  assert.ok(agRow!.warehouses[whIdx].boxes > 0, "کارتنِ انبارِ اول هم جدا شمرده می‌شود، نه قاطی");
});

test("buildMonthlyAgentPerf: باکت‌بندیِ ماهانه‌ی شمسی + مقدارِ نماینده در ماهِ جاری", async () => {
  const AG3 = "a5555555-5555-5555-5555-555555555557";
  await sql.unsafe(`
    INSERT INTO agent_account (id,tenant_id,legal_name,code,price_list_id) VALUES ('${AG3}','${T}','نمایندگی ج','AG3','${PL}');
  `);
  const r = await reserve({ tenantId: T, agentAccountId: AG3, ttlHours: 24, idempotencyKey: "monthly-1", items: [{ lotId: LOT_HOT, quantityBoxes: 7 }] });
  const a = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  assert.equal(a.ok, true);

  const rep = await buildMonthlyAgentPerf({ tenantId: T, months: 3 });
  assert.equal(rep.buckets.length, 3, "دقیقاً سه باکتِ ماهانه");

  const todayJ = toJalali(new Date());
  const lastBucket = rep.buckets[rep.buckets.length - 1];
  assert.equal(lastBucket.jy, todayJ.jy, "آخرین باکت باید ماهِ جاری باشد");
  assert.equal(lastBucket.jm, todayJ.jm);

  const row = rep.rows.find((x) => x.agentId === AG3);
  assert.ok(row, "نماینده‌ی تازه باید در فهرست باشد");
  const currentMonthCell = row!.months[row!.months.length - 1];
  assert.equal(currentMonthCell.boxes, 7);
  assert.equal(currentMonthCell.value, 7_000_000, "۷ کارتن × ۱٬۰۰۰٬۰۰۰ ریال");
});

test("buildMonthlyAgentPerf: تعدادِ ماه بینِ ۱ تا ۱۲ کلمپ می‌شود", async () => {
  const tooMany = await buildMonthlyAgentPerf({ tenantId: T, months: 100 });
  assert.equal(tooMany.buckets.length, 12);
  const tooFew = await buildMonthlyAgentPerf({ tenantId: T, months: 0 });
  assert.equal(tooFew.buckets.length, 1);
});
