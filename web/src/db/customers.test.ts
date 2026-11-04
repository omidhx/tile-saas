import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { T, U, seedTenantUser } from "./_fixtures";
import { reserve } from "./reservations";
import { approveReservation } from "./salesRequests";
import { createDispatchFromRequest, setDispatchStatus, createBackorderDispatch } from "./dispatches";
import { addCustomer, listCustomers, updateCustomer, customerSales, customerHistory } from "./customers";

/**
 * مشتری به‌عنوان Entity. تمرکز روی چیزی که spec ارتقا را مشروط به آن کرده بود
 * (گزارشِ پرخریدترین مشتری) و دو قاعده‌ای که نباید بشکنند:
 *   • نامِ روی حواله snapshot است — اصلاحِ نامِ مشتری تاریخچه را بازنویسی نمی‌کند.
 *   • ارزشِ نامعلوم با صفر یکی گزارش نمی‌شود.
 */

const AG = "a5555555-5555-5555-5555-555555555555";
const AG2 = "a5555555-5555-5555-5555-555555555556";
const PL = "aaaa1111-1111-1111-1111-111111111111";
const WH = "a3333333-3333-3333-3333-333333333333";
const V = "a2222222-2222-2222-2222-222222222222";
const LOT = "a4444444-4444-4444-4444-444444444444";

/** ترتیب مهم است: اقلامِ حواله به حواله ارجاع می‌دهند، پس اول آن‌ها. */
const clearDispatches = async () => {
  await sql`DELETE FROM sales_dispatch_item WHERE tenant_id = ${T}`;
  await sql`DELETE FROM sales_dispatch WHERE tenant_id = ${T}`;
};

const range = () => ({ from: new Date(Date.now() - 7 * 86400000), to: new Date(Date.now() + 86400000) });
let seq = 0;
const key = () => `cust-${++seq}`;

before(async () => {
  await resetSchema();
  await seedTenantUser();
  await sql.unsafe(`
    INSERT INTO price_list (id,tenant_id,name) VALUES ('${PL}','${T}','L');
    INSERT INTO agent_account (id,tenant_id,legal_name,code,price_list_id) VALUES
      ('${AG}','${T}','نمایندگی الف','AG1','${PL}'),
      ('${AG2}','${T}','نمایندگی ب','AG2','${PL}');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','W','W1','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P','کاشی');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${V}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO price_list_item (tenant_id,price_list_id,variant_id,price) VALUES ('${T}','${PL}','${V}',1000000);
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES ('${LOT}','${T}','${V}','${WH}');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT}',1000);
  `);
});
after(async () => { await sql.end(); });

/** رزرو → تأیید → حواله (با مشتری) → بارگیری. */
async function sell(qty: number, code: string, customerId: string | null, customerName: string) {
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: key(), items: [{ lotId: LOT, quantityBoxes: qty }] });
  assert.ok(r.ok);
  const a = await approveReservation({ tenantId: T, reservationId: r.reservationId, actorUserId: U });
  assert.ok(a.ok);
  const d = await createDispatchFromRequest({
    tenantId: T, salesRequestId: a.salesRequestId, createdByUserId: U,
    dispatchCode: code, customerName, customerId: customerId ?? undefined,
  });
  assert.ok(d.ok);
  const id = d.dispatchIds[0];
  await setDispatchStatus({ tenantId: T, dispatchId: id, toStatus: "ready_for_loading", actorUserId: U });
  await setDispatchStatus({ tenantId: T, dispatchId: id, toStatus: "loaded", actorUserId: U });
  return id;
}

test("ساخت و فهرست، و محدود بودن به نمایندگیِ خودش", async () => {
  const mine = await addCustomer({ tenantId: T, name: "آقای رضایی", phone: "0912", agentAccountId: AG });
  await addCustomer({ tenantId: T, name: "مشتریِ نمایندگیِ دیگر", agentAccountId: AG2 });

  const all = await listCustomers({ tenantId: T });
  assert.equal(all.items.length, 2, "staff همه را می‌بیند");
  assert.equal(all.hasMore, false);

  const onlyMine = await listCustomers({ tenantId: T, agentAccountId: AG });
  assert.equal(onlyMine.items.length, 1, "نماینده نباید مشتریانِ نمایندگیِ دیگر را ببیند");
  assert.equal(onlyMine.items[0].id, mine);
  assert.equal(onlyMine.items[0].agentName, "نمایندگی الف");
});

test("🔴 نامِ روی حواله snapshot است — اصلاحِ نامِ مشتری تاریخچه را بازنویسی نمی‌کند", async () => {
  const c = await addCustomer({ tenantId: T, name: "نامِ اولیه", agentAccountId: AG });
  const dispatchId = await sell(10, "D-SNAP", c, "نامِ اولیه");

  await updateCustomer({ tenantId: T, id: c, actorUserId: U, name: "نامِ اصلاح‌شده" });

  const [row] = await sql<{ customer_name: string }[]>`
    SELECT customer_name FROM sales_dispatch WHERE id = ${dispatchId}`;
  assert.equal(row.customer_name, "نامِ اولیه",
    "حواله‌ی صادرشده باید همان نامی را نگه دارد که رویش نوشته شده بود");
});

test("🔴 ویرایشِ مشتری ردپا می‌گذارد — فقط برای فیلدهای واقعاً تغییرکرده", async () => {
  const c = await addCustomer({ tenantId: T, name: "قبلی", agentAccountId: AG, phone: "0911" });
  await updateCustomer({ tenantId: T, id: c, actorUserId: U, name: "جدید", phone: "0911" });

  const [row] = await sql<{ oldValue: unknown; newValue: unknown; entity: string }[]>`
    SELECT old_value AS "oldValue", new_value AS "newValue", entity
    FROM audit_log WHERE tenant_id = ${T} AND action = 'customer.edit' AND entity_id = ${c}`;
  assert.ok(row, "تغییرِ نام باید ردپا بگذارد");
  assert.equal(row.entity, "customer");
  assert.deepEqual(row.oldValue, { name: "قبلی" }, "phone تغییر نکرده — نباید در ردپا بیاید");
  assert.deepEqual(row.newValue, { name: "جدید" });
});

test("پرخریدترین مشتری: ارزش از snapshotِ سفارش، کارتن از لجر", async () => {
  await clearDispatches();
  const big = await addCustomer({ tenantId: T, name: "مشتری بزرگ", agentAccountId: AG });
  const small = await addCustomer({ tenantId: T, name: "مشتری کوچک", agentAccountId: AG });

  await sell(50, "D-BIG", big, "مشتری بزرگ");
  await sell(10, "D-SMALL", small, "مشتری کوچک");

  const rows = await customerSales({ tenantId: T, ...range() });
  assert.equal(rows[0].name, "مشتری بزرگ", "بیشترین ارزش باید اول باشد");
  assert.equal(rows[0].value, 50_000_000);
  assert.equal(rows[0].boxes, 50, "کارتن از لجرِ بارگیری، نه از سفارش");
  assert.equal(rows[1].value, 10_000_000);
});

test("🔴 حواله‌ی بدونِ ارزشِ معلوم، صفر گزارش نمی‌شود — جدا شمرده می‌شود", async () => {
  await clearDispatches();
  const c = await addCustomer({ tenantId: T, name: "مشتری backorder", agentAccountId: AG });
  // حواله‌ی backorder سفارش ندارد، پس ارزشش نامعلوم است (نه صفر)
  const bo = await createBackorderDispatch({
    tenantId: T, agentAccountId: AG, createdByUserId: U, dispatchCode: "BO-C",
    customerName: "مشتری backorder", customerId: c,
    items: [{ variantId: V, quantityBoxes: 5 }],
  });
  assert.ok(bo.ok);

  const rows = await customerSales({ tenantId: T, ...range() });
  const row = rows.find((r) => r.customerId === c)!;
  assert.equal(row.unknownValueDispatches, 1,
    "«ارزش نامعلوم» با «ارزش صفر» یکی نیست — وگرنه گزارش بی‌سروصدا کم‌شمار می‌شود");
});

test("حواله‌ی قدیمیِ بدونِ Entity حذف نمی‌شود، با linked=false می‌آید", async () => {
  await clearDispatches();
  await sell(20, "D-LEGACY", null, "مشتریِ متنِ آزاد");

  const rows = await customerSales({ tenantId: T, ...range() });
  const legacy = rows.find((r) => r.name === "مشتریِ متنِ آزاد");
  assert.ok(legacy, "حذفش یعنی گزارش کمتر از واقعیت نشان دهد");
  assert.equal(legacy.linked, false, "تا معلوم باشد این ردیف به مشتریِ ثبت‌شده وصل نیست");
  assert.equal(legacy.boxes, 20);
});

test("حواله‌ی لغوشده در گزارش نمی‌آید", async () => {
  await clearDispatches();
  const c = await addCustomer({ tenantId: T, name: "مشتری لغو", agentAccountId: AG });
  await sell(15, "D-CANCEL", c, "مشتری لغو");
  await sql`UPDATE sales_dispatch SET status = 'cancelled' WHERE tenant_id = ${T}`;

  const rows = await customerSales({ tenantId: T, ...range() });
  assert.equal(rows.find((r) => r.customerId === c), undefined);
});

test("تاریخچه‌ی مشتری، حواله‌هایش را برمی‌گرداند", async () => {
  await clearDispatches();
  const c = await addCustomer({ tenantId: T, name: "مشتری تاریخچه", agentAccountId: AG });
  await sell(12, "D-H1", c, "مشتری تاریخچه");

  const h = await customerHistory({ tenantId: T, customerId: c });
  assert.equal(h.length, 1);
  assert.equal(h[0].dispatchCode, "D-H1");
  assert.equal(h[0].boxes, 12);
  assert.equal(h[0].agentName, "نمایندگی الف");
});

test("غیرفعال‌کردن مشتری، حذفش نمی‌کند (تاریخچه باید بماند)", async () => {
  const c = await addCustomer({ tenantId: T, name: "مشتری غیرفعال", agentAccountId: AG });
  await updateCustomer({ tenantId: T, id: c, actorUserId: U, isActive: false });
  const list = await listCustomers({ tenantId: T, agentAccountId: AG });
  const row = list.items.find((x) => x.id === c)!;
  assert.equal(row.isActive, false, "غیرفعال، نه حذف — وگرنه حواله‌های گذشته مرجعشان را از دست می‌دهند");
});

test("نامِ خالی رد می‌شود", async () => {
  await assert.rejects(addCustomer({ tenantId: T, name: "   " }));
});

test("listCustomers: صفحه‌بندی با limit+1 (hasMore درست) + جستجو روی نام", async () => {
  for (const name of ["جستجو-یک", "جستجو-دو", "جستجو-سه"]) await addCustomer({ tenantId: T, name });

  const total = (await listCustomers({ tenantId: T, limit: 1000 })).items.length;
  assert.ok(total >= 3);

  const page1 = await listCustomers({ tenantId: T, limit: total - 1 });
  assert.equal(page1.items.length, total - 1, "فقط limit تا برمی‌گرده، نه limit+1");
  assert.equal(page1.hasMore, true, "ردیفِ اضافه‌ی limit+1 باید hasMore=true بدهد");

  const page2 = await listCustomers({ tenantId: T, limit: total - 1, offset: total - 1 });
  assert.equal(page2.items.length, 1, "صفحه‌ی دوم باید دقیقاً بقیه را بدهد");
  assert.equal(page2.hasMore, false, "بعدِ آخرین صفحه دیگه hasMore نیست");

  const found = await listCustomers({ tenantId: T, q: "جستجو-دو" });
  assert.equal(found.items.length, 1);
  assert.equal(found.items[0].name, "جستجو-دو");
});
