import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { reserve } from "./reservations";
import { T, seedTenant } from "./_fixtures";

/**
 * تأیید هیبریدی. تمرکزِ تست‌ها روی **مرزها و مسیرهای ابهام** است، نه حالتِ خوش:
 * هر مسیری که ارزشِ سفارش نامعلوم باشد باید به تأییدِ دستی برود، چون تأییدِ خودکارِ
 * اشتباه پول را متعهد می‌کند.
 */

const AG = "a5555555-5555-5555-5555-555555555555";   // سقفِ خودش را ندارد → ارث از tenant
const AG2 = "a5555555-5555-5555-5555-555555555556";  // سقفِ اختصاصی
const PL = "aaaa1111-1111-1111-1111-111111111111";
const WH = "a3333333-3333-3333-3333-333333333333";
const V = "a2222222-2222-2222-2222-222222222222";
const V_FREE = "a2222222-2222-2222-2222-222222222223"; // عمداً بی‌قیمت
const LOT = "a4444444-4444-4444-4444-444444444444";
const LOT_FREE = "a4444444-4444-4444-4444-444444444445";

const PRICE = 1_000_000; // هر کارتن

let seq = 0;
const key = () => `auto-${++seq}`;

before(async () => {
  await resetSchema();
  await seedTenant();
  await sql.unsafe(`
    INSERT INTO price_list (id,tenant_id,name) VALUES ('${PL}','${T}','L');
    INSERT INTO agent_account (id,tenant_id,legal_name,code,price_list_id) VALUES
      ('${AG}','${T}','نماینده ارثی','AG1','${PL}'),
      ('${AG2}','${T}','نماینده با سقف خودش','AG2','${PL}');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','W','W1','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES
      ('a1111111-1111-1111-1111-111111111111','${T}','P1','قیمت‌دار'),
      ('a1111111-1111-1111-1111-111111111112','${T}','P2','بی‌قیمت');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES
      ('${V}','${T}','a1111111-1111-1111-1111-111111111111','S1'),
      ('${V_FREE}','${T}','a1111111-1111-1111-1111-111111111112','S2');
    INSERT INTO price_list_item (tenant_id,price_list_id,variant_id,price) VALUES ('${T}','${PL}','${V}',${PRICE});
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES
      ('${LOT}','${T}','${V}','${WH}'), ('${LOT_FREE}','${T}','${V_FREE}','${WH}');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES
      ('${T}','${LOT}',100000), ('${T}','${LOT_FREE}',10000);
  `);
});
after(async () => { await sql.end(); });

// هر تست از سقفِ تمیز شروع می‌شود
beforeEach(async () => {
  await sql`UPDATE tenant SET auto_approve_limit = NULL WHERE id = ${T}`;
  await sql`UPDATE agent_account SET auto_approve_limit = NULL WHERE tenant_id = ${T}`;
});

const reserveBoxes = (agentAccountId: string, qty: number, lotId = LOT) =>
  reserve({ tenantId: T, agentAccountId, ttlHours: 24, idempotencyKey: key(), items: [{ lotId, quantityBoxes: qty }] });

test("پیش‌فرض خاموش است — بدون سقف، هیچ چیز خودکار تأیید نمی‌شود", async () => {
  const r = await reserveBoxes(AG, 1);
  assert.ok(r.ok);
  assert.equal(r.autoApproved, undefined, "سقفِ تعریف‌نشده یعنی رفتارِ قبلی: تأییدِ دستی");
});

test("زیرِ سقف → خودکار تأیید می‌شود و سفارشِ approved می‌سازد", async () => {
  await sql`UPDATE tenant SET auto_approve_limit = ${10 * PRICE} WHERE id = ${T}`;
  const r = await reserveBoxes(AG, 5); // ۵٬۰۰۰٬۰۰۰ ≤ ۱۰٬۰۰۰٬۰۰۰
  assert.ok(r.ok);
  assert.ok(r.autoApproved, "باید خودکار تأیید شود");
  assert.equal(r.autoApproved.orderValue, 5 * PRICE);

  const [sr] = await sql<{ status: string; approval_mode: string; auto_approve_limit_applied: string }[]>`
    SELECT status, approval_mode, auto_approve_limit_applied FROM sales_request WHERE id = ${r.autoApproved.salesRequestId}`;
  assert.equal(sr.status, "approved");
  assert.equal(sr.approval_mode, "auto", "باید ثبت شود که خودکار بود، نه دستی");
  assert.equal(Number(sr.auto_approve_limit_applied), 10 * PRICE, "سقفِ لحظه‌ی تأیید snapshot می‌شود");

  // رزرو مصرف شد و موجودی به allocated رفت — دقیقاً مثل تأییدِ دستی
  const [resv] = await sql<{ status: string }[]>`SELECT status FROM reservation WHERE id = ${r.reservationId}`;
  assert.equal(resv.status, "converted");
});

test("دقیقاً روی سقف → تأیید می‌شود (سقف شاملِ خودش است)", async () => {
  await sql`UPDATE tenant SET auto_approve_limit = ${5 * PRICE} WHERE id = ${T}`;
  const r = await reserveBoxes(AG, 5);
  assert.ok(r.ok);
  assert.ok(r.autoApproved, "«زیر سقف» شاملِ برابر است — وگرنه سقفِ گِردِ ۵٬۰۰۰٬۰۰۰ عملاً ۴٬۹۹۹٬۹۹۹ می‌شد");
});

test("یک ریال بالای سقف → به صفِ تأییدِ دستی می‌رود", async () => {
  await sql`UPDATE tenant SET auto_approve_limit = ${5 * PRICE - 1} WHERE id = ${T}`;
  const r = await reserveBoxes(AG, 5);
  assert.ok(r.ok);
  assert.equal(r.autoApproved, undefined);
  const [resv] = await sql<{ status: string }[]>`SELECT status FROM reservation WHERE id = ${r.reservationId}`;
  assert.equal(resv.status, "active", "رزرو دست‌نخورده می‌ماند تا پشتیبان ببیند");
});

test("سقفِ نماینده بر سقفِ کارخانه ارجح است", async () => {
  await sql`UPDATE tenant SET auto_approve_limit = ${100 * PRICE} WHERE id = ${T}`;
  await sql`UPDATE agent_account SET auto_approve_limit = ${2 * PRICE} WHERE id = ${AG2}`;

  const generous = await reserveBoxes(AG, 50);   // ارث از کارخانه → مجاز
  assert.ok(generous.ok && generous.autoApproved, "نماینده‌ی بدون سقفِ خودش از کارخانه ارث می‌برد");

  const strict = await reserveBoxes(AG2, 50);    // سقفِ خودش کمتر است → رد
  assert.ok(strict.ok);
  assert.equal(strict.autoApproved, undefined, "سقفِ اختصاصیِ کمتر باید برنده شود");
});

test("سقفِ صفرِ نماینده یعنی «هرگز خودکار»، حتی وقتی کارخانه سخاوتمند است", async () => {
  await sql`UPDATE tenant SET auto_approve_limit = ${1000 * PRICE} WHERE id = ${T}`;
  await sql`UPDATE agent_account SET auto_approve_limit = 0 WHERE id = ${AG2}`;
  const r = await reserveBoxes(AG2, 1);
  assert.ok(r.ok);
  assert.equal(r.autoApproved, undefined, "۰ باید «هرگز» باشد، نه «ارث بگیر» — تفاوتِ NULL و ۰");
});

test("خطِ بی‌قیمت → دستی، حتی اگر بقیه‌ی سفارش زیرِ سقف باشد", async () => {
  await sql`UPDATE tenant SET auto_approve_limit = ${1000 * PRICE} WHERE id = ${T}`;
  const r = await reserve({
    tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: key(),
    items: [{ lotId: LOT, quantityBoxes: 1 }, { lotId: LOT_FREE, quantityBoxes: 1 }],
  });
  assert.ok(r.ok);
  assert.equal(r.autoApproved, undefined,
    "ارزشِ ناقص را با سقف مقایسه کردن یعنی سفارشِ گران به‌خاطرِ قیمتِ گمشده خودکار تأیید شود");
});

test("تخفیف حجمی در سنجشِ سقف حساب می‌شود — همان عددی که snapshot می‌شود", async () => {
  // ۱۰٪ تخفیف از ۱۰۰ کارتن ⇒ ۱۰۰ کارتن = ۹۰٬۰۰۰٬۰۰۰ نه ۱۰۰٬۰۰۰٬۰۰۰
  await sql`INSERT INTO volume_discount (tenant_id,price_list_id,variant_id,min_qty_boxes,percent_off)
            VALUES (${T},${PL},${V},100,10)`;
  await sql`UPDATE tenant SET auto_approve_limit = ${95 * PRICE} WHERE id = ${T}`;

  const r = await reserveBoxes(AG, 100);
  assert.ok(r.ok);
  assert.ok(r.autoApproved, "قیمتِ پس از تخفیف زیرِ سقف است، پس باید تأیید شود");
  assert.equal(r.autoApproved.orderValue, 90 * PRICE, "سقف باید با مبلغِ پرداختی سنجیده شود نه مبلغِ ناخالص");

  // همان عدد باید در snapshotِ سفارش هم باشد — دو محاسبه‌ی جدا نباید واگرا شوند
  const [line] = await sql<{ unit_price_applied: string; discount_amount: string; requested_qty_boxes: number }[]>`
    SELECT unit_price_applied, discount_amount, requested_qty_boxes
    FROM sales_request_item WHERE request_id = ${r.autoApproved.salesRequestId}`;
  const snapshotValue = Number(line.unit_price_applied) * line.requested_qty_boxes - Number(line.discount_amount);
  assert.equal(snapshotValue, r.autoApproved.orderValue, "تصمیم و snapshot باید یک عدد باشند");

  await sql`DELETE FROM volume_discount WHERE tenant_id = ${T}`;
});

test("لجر پس از تأییدِ خودکار تراز می‌ماند و actor خالی است (نه کاربرِ جعلی)", async () => {
  await sql`UPDATE tenant SET auto_approve_limit = ${10 * PRICE} WHERE id = ${T}`;
  const r = await reserveBoxes(AG, 3);
  assert.ok(r.ok && r.autoApproved);

  const [txn] = await sql<{ actor_user_id: string | null; note: string }[]>`
    SELECT actor_user_id, note FROM inventory_transaction
    WHERE reference_id = ${r.autoApproved.salesRequestId} AND transaction_type = 'reservation_convert'`;
  assert.equal(txn.actor_user_id, null, "کاربرِ انسانی وجود نداشته، پس نباید کسی را مسئول نشان دهیم");
  assert.match(txn.note, /تأیید خودکار/, "لجر باید بگوید چرا بدونِ actor تأیید شده");

  const [{ bad }] = await sql<{ bad: number }[]>`
    SELECT count(*)::int AS bad FROM (
      SELECT b.lot_id FROM inventory_balance b
      LEFT JOIN inventory_transaction t ON t.lot_id = b.lot_id
      WHERE b.tenant_id = ${T}
      GROUP BY b.lot_id, b.allocated_qty_boxes
      HAVING COALESCE(SUM(t.allocated_delta_boxes),0) <> b.allocated_qty_boxes
    ) x`;
  assert.equal(bad, 0, "تأییدِ خودکار نباید لجر را ناتراز کند");
});
