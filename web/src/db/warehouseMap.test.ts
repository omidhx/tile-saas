import { test, before } from "node:test";
import assert from "node:assert/strict";
import { sql, resetSchema } from "./_testdb";
import { withTenant } from "./client";
import { T, U, seedTenantUser } from "./_fixtures";
import { goodsIn, transferPallet } from "./pallets";
import { reserve } from "./reservations";
import { deleteWarehouse } from "./warehouses";
import { getWarehouseMap, saveLayout, type Cell } from "./warehouseMap";
import { columnKey, slotKey } from "@/lib/slotKey";

/** فاز ۸: نقشه‌ی انبار. oracle اتصال admin است؛ کد محصول با app_user و RLS. */

const AG = "a5555555-5555-5555-5555-555555555555";
const W1 = "a3333333-3333-3333-3333-333333333331";
const W2 = "a3333333-3333-3333-3333-333333333332";
const V = "a2222222-2222-2222-2222-222222222222";
const TB = "22222222-2222-2222-2222-222222222222";
const WB = "a3333333-3333-3333-3333-33333333333b";

before(async () => {
  await resetSchema();
  await seedTenantUser();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${TB}','B','b');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES
      ('${W1}','${T}','انبار ۱','W1','main'), ('${W2}','${T}','انبار ۲','W2','main'), ('${WB}','${TB}','B','WB','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','کاشی ۶۰×۶۰');
    INSERT INTO product_variant (id,tenant_id,product_id,sku,grade,boxes_per_pallet,sqcm_per_box) VALUES
      ('${V}','${T}','a1111111-1111-1111-1111-111111111111','S2','۲',96,14400);
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
  `);
});

const slot = (x: number, y: number, col: string, pos: number): Cell => ({ x, y, kind: "slot", columnCode: col, positionNo: pos });
const aisle = (x: number, y: number): Cell => ({ x, y, kind: "aisle", columnCode: null, positionNo: null });
const LAYOUT = [slot(0, 0, "A", 1), slot(1, 0, "A", 2), slot(2, 0, "A", 3), aisle(0, 1), aisle(1, 1), slot(0, 2, "B", 1)];

async function palletIn(batch: string, qty: number, col: string | null, pos: number | null) {
  const r = await goodsIn({ tenantId: T, actorUserId: U, warehouseId: W1, pallets: [{ columnCode: col, positionNo: pos, repeat: 1, lines: [{ variantId: V, batchNumber: batch, qty }] }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const [{ id, lot }] = await sql<{ id: string; lot: string }[]>`
    SELECT p.id, pi.lot_id AS lot FROM pallet p JOIN pallet_item pi ON pi.pallet_id = p.id WHERE p.pallet_no = ${r.ok ? r.palletNos[0] : 0}`;
  return { id, lot };
}

test("چیدمان ذخیره و خوانده می‌شود؛ پالت با ستون و شماره‌ی خودش (بدون حساسیت به حروف) روی خانه است", async () => {
  const r = await saveLayout({ tenantId: T, actorUserId: U, warehouseId: W1, cells: LAYOUT });
  assert.deepEqual(r, { ok: true, cells: 6, offMap: 0 });
  await palletIn("m1", 10, " a ", 2);
  const m = (await getWarehouseMap({ tenantId: T, warehouseId: W1 }))!;
  assert.equal(m.cells.length, 6);
  assert.deepEqual(m.cells.find((c) => c.x === 1 && c.y === 0), slot(1, 0, "A", 2));
  assert.equal(m.pallets.length, 1);
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE action = 'warehouse.layout'`;
  assert.equal(n, 1);
});

test("ذخیره‌ی چیدمان پالتی را عوض نمی‌کند و پالتِ بی‌جا را در offMap می‌شمارد", async () => {
  const before = await sql`SELECT id, column_code, position_no FROM pallet ORDER BY id`;
  const r = await saveLayout({ tenantId: T, actorUserId: U, warehouseId: W1, cells: [slot(0, 0, "B", 1)] });
  assert.deepEqual(r, { ok: true, cells: 1, offMap: 1 });
  assert.deepEqual(await sql`SELECT id, column_code, position_no FROM pallet ORDER BY id`, before);
  assert.equal((await saveLayout({ tenantId: T, actorUserId: U, warehouseId: W1, cells: LAYOUT })).ok, true);
});

test("خانه‌ی تکراری و «ستون + شماره»ی تکراری رد می‌شود؛ در کد و در خود دیتابیس", async () => {
  assert.deepEqual(await saveLayout({ tenantId: T, actorUserId: U, warehouseId: W1, cells: [slot(0, 0, "A", 1), aisle(0, 0)] }),
    { ok: false, reason: "duplicate_cell" });
  const d = await saveLayout({ tenantId: T, actorUserId: U, warehouseId: W1, cells: [slot(0, 0, "A", 1), slot(1, 0, " a", 1)] });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.reason, "duplicate_slot");
  assert.equal((await saveLayout({ tenantId: T, actorUserId: U, warehouseId: W1, cells: [{ x: 0, y: 0, kind: "slot", columnCode: " ", positionNo: 1 }] })).ok, false);
  // لایه‌ی دوم: ایندکس یکتا، با نقش app_user
  await assert.rejects(withTenant(T, (tx) => tx`
    INSERT INTO warehouse_cell (tenant_id, warehouse_id, x, y, kind, column_code, position_no)
    VALUES (${T}, ${W1}, 9, 9, 'slot', 'a ', 1)`), /uq_warehouse_cell_slot/);
  // چیدمانِ قبلی دست نخورده
  assert.equal((await getWarehouseMap({ tenantId: T, warehouseId: W1 }))!.cells.length, 6);
});

test("ستون با رقم فارسی یا عربی و ي/ك عربی همان جای لاتین است؛ در JS و در SQL", async () => {
  assert.equal(columnKey(" ۱۲ "), "12");
  assert.equal(columnKey("٣a"), "3A");
  assert.equal(columnKey("كي"), "کی");
  assert.equal(slotKey("ب۱", 2), slotKey("ب1", 2));
  const W3 = "a3333333-3333-3333-3333-33333333333a";
  await sql`INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES (${W3},${T},'انبار فارسی','WF','main')`;
  const r = await goodsIn({ tenantId: T, actorUserId: U, warehouseId: W3, pallets: [{ columnCode: "۱۲", positionNo: 3, repeat: 1, lines: [{ variantId: V, batchNumber: "fa1", qty: 5 }] }] });
  assert.equal(r.ok, true);
  // پالتِ «۱۲» با جای «12» تطبیق دارد: بیرون از نقشه نمی‌ماند
  assert.deepEqual(await saveLayout({ tenantId: T, actorUserId: U, warehouseId: W3, cells: [slot(0, 0, "12", 3)] }), { ok: true, cells: 1, offMap: 0 });
  const d = await saveLayout({ tenantId: T, actorUserId: U, warehouseId: W3, cells: [slot(0, 0, "12", 3), slot(1, 0, "۱۲", 3)] });
  assert.equal(!d.ok && d.reason, "duplicate_slot");
  await assert.rejects(withTenant(T, (tx) => tx`
    INSERT INTO warehouse_cell (tenant_id, warehouse_id, x, y, kind, column_code, position_no)
    VALUES (${T}, ${W3}, 5, 5, 'slot', '١٢', 3)`), /uq_warehouse_cell_slot/);
});

test("رنگ وضعیت: آزاد، بخشی رزرو، تمام رزرو — از held زنده، نه ستون ذخیره‌شده", async () => {
  const a = await palletIn("st1", 20, "A", 1);
  const b = await palletIn("st2", 20, "A", 3);
  const status = async (id: string) => (await getWarehouseMap({ tenantId: T, warehouseId: W1 }))!.pallets.find((p) => p.id === id)!.mapStatus;
  assert.equal(await status(a.id), "free");
  let r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "ms1", items: [{ lotId: a.lot, quantityBoxes: 5 }] });
  assert.equal(r.ok, true);
  r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "ms2", items: [{ lotId: b.lot, quantityBoxes: 20 }] });
  assert.equal(r.ok, true);
  assert.equal(await status(a.id), "partial");
  assert.equal(await status(b.id), "reserved");
  // رزرو منقضی دیگر held نیست
  await sql`UPDATE reservation SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE idempotency_key = 'ms2'`;
  assert.equal(await status(b.id), "free");
});

test("جابه‌جایی روی نقشه = transferPallet: پالت روی خانه‌ی تازه، ناوردای پالت سر جایش", async () => {
  const p = await palletIn("mv1", 7, null, null);
  const r = await transferPallet({ tenantId: T, actorUserId: U, palletId: p.id, columnCode: "B", positionNo: 1 });
  assert.equal(r.ok, true);
  const m = (await getWarehouseMap({ tenantId: T, warehouseId: W1 }))!;
  const moved = m.pallets.find((x) => x.id === p.id)!;
  assert.deepEqual([moved.columnCode, moved.positionNo], ["B", 1]);
  const [{ bad }] = await sql<{ bad: number }[]>`
    SELECT count(*)::int AS bad FROM inventory_balance b
    WHERE b.on_hand_qty_boxes <> COALESCE((SELECT SUM(qty_boxes) FROM pallet_item pi WHERE pi.lot_id = b.lot_id), 0)`;
  assert.equal(bad, 0);
});

test("دو ذخیره‌ی هم‌زمانِ چیدمان روی یک انبار: هر دو موفق، نتیجه یکی از آن دو، نه خطای یکتایی", async () => {
  for (let round = 0; round < 3; round++) {
    const one = [slot(0, 0, "Q", 1), slot(1, 0, "Q", 2)];
    const two = [slot(0, 0, "Q", 1), slot(1, 0, "Q", 2), aisle(2, 0)];
    const rs = await Promise.all([1, 2, 3, 4].map((i) => saveLayout({ tenantId: T, actorUserId: U, warehouseId: W2, cells: i % 2 ? one : two })));
    assert.deepEqual(rs.map((r) => r.ok), [true, true, true, true]);
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM warehouse_cell WHERE warehouse_id = ${W2}`;
    assert.ok(n === 2 || n === 3, `خانه‌ها: ${n}`);
  }
});

test("ایزوله‌ی tenant: B نقشه‌ی A را نمی‌بیند و نمی‌نویسد؛ FK ترکیبی انبار tenant دیگر را رد می‌کند", async () => {
  assert.equal(await getWarehouseMap({ tenantId: TB, warehouseId: W1 }), null);
  assert.deepEqual(await saveLayout({ tenantId: TB, actorUserId: U, warehouseId: W1, cells: [slot(0, 0, "X", 1)] }),
    { ok: false, reason: "warehouse_not_found" });
  const seen = await withTenant(TB, (tx) => tx`SELECT 1 FROM warehouse_cell`);
  assert.equal(seen.length, 0);
  await assert.rejects(withTenant(TB, (tx) => tx`
    INSERT INTO warehouse_cell (tenant_id, warehouse_id, x, y, kind) VALUES (${TB}, ${W1}, 0, 0, 'aisle')`));
  assert.equal((await getWarehouseMap({ tenantId: T, warehouseId: W1 }))!.cells.length, 6);
});

test("انبارِ بی‌کالا با چیدمان پاک می‌شود", async () => {
  const W3 = "a3333333-3333-3333-3333-333333333339";
  await sql`INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES (${W3},${T},'انبار ۳','W3','main')`;
  assert.equal((await saveLayout({ tenantId: T, actorUserId: U, warehouseId: W3, cells: LAYOUT })).ok, true);
  assert.deepEqual(await deleteWarehouse({ tenantId: T, warehouseId: W3 }), { ok: true });
});
