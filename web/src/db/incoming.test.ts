import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { T, U, seedTenantUser } from "./_fixtures";
import { addIncoming, listIncoming, markArrived, expectedArrivals, setIncomingStatus } from "./incoming";
import { joinWaitlist } from "./waitlist";

/**
 * موجودی در راه. دو چیز که نباید بشکنند:
 *   ۱. **available آلوده نشود** — موجودیِ نیامده هرگز قابلِ سفارش نیست.
 *   ۲. **لجر تراز بماند** — رسیدن از همان مسیرِ import عبور کند، نه UPDATE مستقیم.
 */

const AG = "a5555555-5555-5555-5555-555555555555";
const WH = "a3333333-3333-3333-3333-333333333333";
const V = "a2222222-2222-2222-2222-222222222222";

before(async () => {
  await resetSchema();
  await seedTenantUser();
  await sql.unsafe(`
    INSERT INTO tenant_membership (tenant_id,user_id,role) VALUES ('${T}','${U}','agent');
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','نماینده','AG1');
    INSERT INTO agent_account_user (tenant_id,agent_account_id,user_id,role) VALUES ('${T}','${AG}','${U}','op');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','انبار','W1','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P','کاشی');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${V}','${T}','a1111111-1111-1111-1111-111111111111','S1');
  `);
});
after(async () => { await sql.end(); });

beforeEach(async () => {
  await sql`DELETE FROM incoming_stock WHERE tenant_id = ${T}`;
  await sql`DELETE FROM waitlist_entry WHERE tenant_id = ${T}`;
  await sql`DELETE FROM notification_outbox WHERE tenant_id = ${T}`;
  // ترتیب مهم است: هر چیزی که به lot ارجاع می‌دهد اول برود، وگرنه FK جلویش را می‌گیرد
  await sql`DELETE FROM reservation_item WHERE tenant_id = ${T}`;
  await sql`DELETE FROM reservation WHERE tenant_id = ${T}`;
  await sql`DELETE FROM inventory_transaction WHERE tenant_id = ${T}`;
  await sql`DELETE FROM inventory_balance WHERE tenant_id = ${T}`;
  await sql`DELETE FROM inventory_lot WHERE tenant_id = ${T}`;
});

const addSoon = (qty = 200) =>
  addIncoming({ tenantId: T, variantId: V, warehouseId: WH, quantityBoxes: qty, expectedAt: "2026-09-01", note: "تولید مهر" });

const availableOf = async () => {
  const [r] = await sql<{ n: number | null }[]>`
    SELECT COALESCE(SUM(a.available_qty_boxes), 0)::int AS n
    FROM v_lot_availability a JOIN inventory_lot l ON l.id = a.lot_id
    WHERE l.tenant_id = ${T} AND l.variant_id = ${V}`;
  return r.n ?? 0;
};

test("🔴 موجودیِ در راه وارد available نمی‌شود", async () => {
  await addSoon(500);
  assert.equal(await availableOf(), 0,
    "اگر نیامده available شود، نماینده روی کالای ناموجود سفارش می‌دهد");
});

test("نماینده محموله را با تاریخش می‌بیند", async () => {
  await addSoon(200);
  const map = await expectedArrivals({ tenantId: T, variantIds: [V] });
  assert.equal(map[V].length, 1);
  assert.equal(map[V][0].quantityBoxes, 200);
  assert.equal(map[V][0].status, "planned");
  assert.ok(map[V][0].expectedAt, "«کِی» همان چیزی است که در v1 کم بود");
});

test("محموله‌ی لغوشده دیگر وعده نیست", async () => {
  await addSoon();
  const [row] = await listIncoming(T);
  await setIncomingStatus({ tenantId: T, id: row.id, status: "cancelled" });
  const map = await expectedArrivals({ tenantId: T, variantIds: [V] });
  assert.equal(map[V], undefined, "وعده‌ی لغوشده نباید به نماینده نشان داده شود");
});

test("🔴 رسیدن، موجودی را از مسیرِ لجر اضافه می‌کند (تراز می‌ماند)", async () => {
  await addSoon(300);
  const [row] = await listIncoming(T);
  const r = await markArrived({ tenantId: T, id: row.id, actorUserId: U, batchNumber: "B-1" });
  assert.ok(r.ok);

  assert.equal(await availableOf(), 300, "حالا واقعاً قابلِ سفارش است");

  // همان چکِ گزارشِ تطبیق: جمعِ لجر باید با on_hand بخواند
  const [{ bad }] = await sql<{ bad: number }[]>`
    SELECT count(*)::int AS bad FROM (
      SELECT b.lot_id FROM inventory_balance b
      LEFT JOIN inventory_transaction t ON t.lot_id = b.lot_id
      WHERE b.tenant_id = ${T}
      GROUP BY b.lot_id, b.on_hand_qty_boxes
      HAVING COALESCE(SUM(t.on_hand_delta_boxes),0) <> b.on_hand_qty_boxes
    ) x`;
  assert.equal(bad, 0, "UPDATE مستقیم بدونِ لجر، بلافاصله ناترازی می‌ساخت");
});

test("رسیدن دو بار، موجودی را دو برابر نمی‌کند", async () => {
  await addSoon(100);
  const [row] = await listIncoming(T);
  assert.ok((await markArrived({ tenantId: T, id: row.id, actorUserId: U })).ok);
  const again = await markArrived({ tenantId: T, id: row.id, actorUserId: U });
  assert.deepEqual(again, { ok: false, reason: "not_pending" });
  assert.equal(await availableOf(), 100, "فقط یک بار");
});

test("محموله‌ی دوم از همان بچ، lotِ تکراری نمی‌سازد", async () => {
  await addSoon(100); await addSoon(50);
  const rows = await listIncoming(T);
  for (const r of rows)
    assert.ok((await markArrived({ tenantId: T, id: r.id, actorUserId: U, batchNumber: "B-SAME" })).ok);

  const lots = await sql`SELECT id FROM inventory_lot WHERE tenant_id = ${T} AND variant_id = ${V}`;
  assert.equal(lots.length, 1, "همان بچ در همان انبار = همان lot");
  assert.equal(await availableOf(), 150);
});

test("🔴 با رسیدنِ محموله، صف انتظار جلو می‌رود و اعلان صف می‌شود", async () => {
  await joinWaitlist({ tenantId: T, agentAccountId: AG, variantId: V, quantityBoxes: 40 });
  await addSoon(200);
  const [row] = await listIncoming(T);
  const r = await markArrived({ tenantId: T, id: row.id, actorUserId: U });
  assert.ok(r.ok);
  assert.equal(r.offers, 1, "کسی که ماه‌ها منتظر بود باید نوبتش را بگیرد");

  const left = await sql`SELECT 1 FROM waitlist_entry WHERE tenant_id = ${T}`;
  assert.equal(left.length, 0, "نوبت مصرف شد");
  // ۴۰ کارتن به صف رفت، ۱۶۰ آزاد ماند
  assert.equal(await availableOf(), 160);
});

test("تعدادِ نامعتبر رد می‌شود", async () => {
  await assert.rejects(
    addIncoming({ tenantId: T, variantId: V, warehouseId: WH, quantityBoxes: 0, expectedAt: "2026-09-01" }),
  );
});

test("رسیدنِ محموله‌ی ناموجود → not_found", async () => {
  const r = await markArrived({
    tenantId: T, id: "aaaaaaaa-0000-0000-0000-000000000000", actorUserId: U,
  });
  assert.deepEqual(r, { ok: false, reason: "not_found" });
});
