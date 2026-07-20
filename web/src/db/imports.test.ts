import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { applySnapshot } from "./imports";

const T = "11111111-1111-1111-1111-111111111111";
const U = "a8888888-8888-8888-8888-888888888888";
const VAR = "a2222222-2222-2222-2222-222222222222";
const WA = "aaaaaaa1-0000-0000-0000-000000000001";
const WB = "aaaaaaa2-0000-0000-0000-000000000002";
const WC = "aaaaaaa3-0000-0000-0000-000000000003";
const WD = "aaaaaaa4-0000-0000-0000-000000000004";
const LA1 = "bbbbbbb1-0000-0000-0000-000000000001";
const LA2 = "bbbbbbb2-0000-0000-0000-000000000002";
const LB1 = "bbbbbbb3-0000-0000-0000-000000000003";
const LC1 = "bbbbbbb4-0000-0000-0000-000000000004";
const LD1 = "bbbbbbb5-0000-0000-0000-000000000005";

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','0910','x');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','P1');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${VAR}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES
      ('${WA}','${T}','WA','A','main'), ('${WB}','${T}','WB','B','main'),
      ('${WC}','${T}','WC','C','main'), ('${WD}','${T}','WD','D','main');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id,batch_number) VALUES
      ('${LA1}','${T}','${VAR}','${WA}','B1'), ('${LA2}','${T}','${VAR}','${WA}','B2'),
      ('${LB1}','${T}','${VAR}','${WB}','B1'), ('${LC1}','${T}','${VAR}','${WC}','B1'),
      ('${LD1}','${T}','${VAR}','${WD}','B1');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes,allocated_qty_boxes) VALUES
      ('${T}','${LA1}',100,0), ('${T}','${LA2}',30,0),
      ('${T}','${LB1}',10,5), ('${T}','${LC1}',10,5), ('${T}','${LD1}',40,0);
  `);
});
after(async () => { await sql.end(); });

const onHand = async (lot: string) =>
  Number((await sql<{ v: number }[]>`SELECT on_hand_qty_boxes AS v FROM inventory_balance WHERE lot_id = ${lot}`)[0].v);
const allocated = async (lot: string) =>
  Number((await sql<{ v: number }[]>`SELECT allocated_qty_boxes AS v FROM inventory_balance WHERE lot_id = ${lot}`)[0].v);

test("snapshot: matched به‌روز، جدید ساخته، غایبِ داخلِ scope صفر، انبار دیگر دست‌نخورده", async () => {
  const res = await applySnapshot({
    tenantId: T, uploaderUserId: U, idempotencyKey: "imp-A", scope: { type: "warehouse", warehouseId: WA },
    rows: [
      { sku: "S1", warehouseCode: "A", batchNumber: "B1", onHand: 80 },  // LA1 → 80
      { sku: "S1", warehouseCode: "A", batchNumber: "B3", onHand: 25 },  // lot جدید
    ],
  });
  assert.equal(res.applied, 2);
  assert.equal(res.zeroed, 1, "LA2 (غایب، بدون تعهد) باید صفر شه");
  assert.equal(res.errors.length, 0);

  assert.equal(await onHand(LA1), 80);
  assert.equal(await onHand(LA2), 0, "غایب در scope → صفر");
  const [newLot] = await sql<{ v: number }[]>`
    SELECT b.on_hand_qty_boxes AS v FROM inventory_lot l JOIN inventory_balance b ON b.lot_id = l.id
    WHERE l.warehouse_id = ${WA} AND l.batch_number = 'B3'`;
  assert.equal(Number(newLot.v), 25, "lot جدید ساخته و ۲۵ شد");
  assert.equal(await onHand(LD1), 40, "انبار D خارج از scope — نباید صفر شه (ایزوله‌ی scope)");
});

test("guard below_committed: on_hand زیر allocated+blocked نمی‌ره", async () => {
  const res = await applySnapshot({
    tenantId: T, uploaderUserId: U, idempotencyKey: "imp-B", scope: { type: "warehouse", warehouseId: WB },
    rows: [{ sku: "S1", warehouseCode: "B", batchNumber: "B1", onHand: 3 }],  // LB1 allocated 5
  });
  assert.ok(res.errors.some((e) => e.reason === "below_committed"), "باید below_committed بده");
  assert.equal(res.applied, 0);
  assert.equal(await onHand(LB1), 10, "on_hand نباید تغییر کنه (زیر تعهد نمی‌ره)");
  assert.equal(await allocated(LB1), 5, "allocated دست‌نخورده");
});

test("absent_but_committed: lotِ دارای تعهد که در فایل نیست، صفر نمی‌شه", async () => {
  const res = await applySnapshot({
    tenantId: T, uploaderUserId: U, idempotencyKey: "imp-C", scope: { type: "warehouse", warehouseId: WC },
    rows: [],  // LC1 غایب، ولی allocated 5 دارد
  });
  assert.equal(res.zeroed, 0);
  assert.ok(res.errors.some((e) => e.reason === "absent_but_committed"));
  assert.equal(await onHand(LC1), 10, "نباید صفر شه — تعهد زنده دارد");
});

test("ردیف تکراری برای یک Lot: آخرین مقدار می‌ماند و جمعِ لجر با on_hand می‌خواند", async () => {
  const res = await applySnapshot({
    tenantId: T, uploaderUserId: U, idempotencyKey: "imp-dup", scope: { type: "warehouse", warehouseId: WD },
    rows: [
      { sku: "S1", warehouseCode: "D", batchNumber: "B1", onHand: 70 },
      { sku: "S1", warehouseCode: "D", batchNumber: "B1", onHand: 55 }, // همان Lot، دوباره
    ],
  });
  assert.equal(res.errors.length, 0);
  assert.equal(await onHand(LD1), 55, "آخرین مقدار باید بماند");

  // LD1 در seed مستقیماً روی ۴۰ گذاشته شده (بدون لجر)، پس جمعِ لجر = ۵۵−۴۰ = ۱۵.
  // نکته‌ی اصلی: deltaها باید [+۳۰, −۱۵] باشند — یعنی ردیف دوم از مقدارِ اعمال‌شده (۷۰)
  // حساب شده نه از مقدارِ اولیه (۴۰). اگر base کهنه می‌ماند، delta دوم +۱۵ می‌شد.
  const deltas = (await sql<{ d: number }[]>`
    SELECT on_hand_delta_boxes AS d FROM inventory_transaction
    WHERE lot_id = ${LD1} ORDER BY created_at, d DESC`).map((r) => Number(r.d));
  assert.deepEqual(deltas, [30, -15], "delta دوم باید از مقدارِ اعمال‌شده حساب شود");
});

test("idempotency: کلید تکراری → deduped، بدون اعمال دوباره", async () => {
  const res = await applySnapshot({
    tenantId: T, uploaderUserId: U, idempotencyKey: "imp-A", scope: { type: "warehouse", warehouseId: WA },
    rows: [{ sku: "S1", warehouseCode: "A", batchNumber: "B1", onHand: 999 }],  // اگر دوباره اعمال شه فاجعه
  });
  assert.equal(res.deduped, true);
  assert.equal(res.applied, 0);
  assert.equal(await onHand(LA1), 80, "نباید دوباره اعمال شه (هنوز ۸۰)");
});
