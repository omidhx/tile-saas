import { test, before } from "node:test";
import assert from "node:assert/strict";
import { sql, appSql, resetSchema } from "./_testdb";
import { T, U, seedTenantUser } from "./_fixtures";
import { goodsIn, editPallet, transferPallet, exitStock, listPallets, stockSummary, listExits } from "./pallets";
import { reserve } from "./reservations";
import { approveReservation } from "./salesRequests";
import { createDispatchFromRequest, setDispatchStatus } from "./dispatches";

/**
 * فاز ۷: پالت زیرِ Lot. oracle همه‌جا اتصالِ admin است، مستقل از کدِ محصول:
 *   ناوردا — برای هر lot جمعِ کارتنِ پالت‌ها = on_hand، و لجر = on_hand.
 */

const AG = "a5555555-5555-5555-5555-555555555555";
const W1 = "a3333333-3333-3333-3333-333333333331";
const W2 = "a3333333-3333-3333-3333-333333333332";
const V2 = "a2222222-2222-2222-2222-222222222222"; // درجه ۲
const V3 = "a2222222-2222-2222-2222-222222222223"; // درجه ۳
const TB = "22222222-2222-2222-2222-222222222222";

before(async () => {
  await resetSchema();
  await seedTenantUser();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${TB}','B','b');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES
      ('${W1}','${T}','انبار ۱','W1','main'), ('${W2}','${T}','انبار ۲','W2','main'),
      ('a3333333-3333-3333-3333-33333333333b','${TB}','B','WB','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','کاشی ۶۰×۶۰');
    INSERT INTO product_variant (id,tenant_id,product_id,sku,grade,boxes_per_pallet,sqcm_per_box) VALUES
      ('${V2}','${T}','a1111111-1111-1111-1111-111111111111','S2','۲',96,14400),
      ('${V3}','${T}','a1111111-1111-1111-1111-111111111111','S3','۳',96,14400);
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
  `);
});

/** هر lotِ tenant: on_hand، جمعِ پالت و جمعِ لجر. */
async function invariant() {
  return sql<{ lot_id: string; on_hand: number; pallets: number; ledger: number }[]>`
    SELECT b.lot_id, b.on_hand_qty_boxes AS on_hand,
           COALESCE((SELECT SUM(qty_boxes) FROM pallet_item pi WHERE pi.lot_id = b.lot_id), 0)::int AS pallets,
           COALESCE((SELECT SUM(on_hand_delta_boxes) FROM inventory_transaction t WHERE t.lot_id = b.lot_id), 0)::int AS ledger
    FROM inventory_balance b`;
}
async function assertInvariant() {
  for (const r of await invariant()) {
    assert.equal(r.pallets, r.on_hand, `پالت‌های lot ${r.lot_id} با on_hand برابر نیست`);
    assert.equal(r.ledger, r.on_hand, `لجرِ lot ${r.lot_id} با on_hand برابر نیست`);
  }
}
const onHand = async (lotId: string) =>
  (await sql<{ q: number }[]>`SELECT on_hand_qty_boxes AS q FROM inventory_balance WHERE lot_id = ${lotId}`)[0].q;
const lotOf = async (variant: string, batch: string, wh = W1) =>
  (await sql<{ id: string }[]>`SELECT id FROM inventory_lot WHERE variant_id = ${variant} AND warehouse_id = ${wh} AND upper(batch_number) = upper(${batch})`)[0]?.id;
const palletByNo = async (no: number) => (await listPallets({ tenantId: T, status: "all", q: String(no) })).find((p) => p.palletNo === no)!;

/** n پالتِ یک‌ردیفی در W1، با بچِ داده‌شده. */
async function stock(batch: string, qty: number, repeat: number, col = "A") {
  const r = await goodsIn({ tenantId: T, actorUserId: U, warehouseId: W1, pallets: [{ columnCode: col, positionNo: 1, repeat, lines: [{ variantId: V2, batchNumber: batch, qty }] }] });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { lot: (await lotOf(V2, batch))!, palletNos: r.ok ? r.palletNos : [] };
}

test("ورود کالا: پالتِ ترکیبی با دو درجه و «تکرار ×۳» با شماره‌های پشت‌سرِهم", async () => {
  const r = await goodsIn({
    tenantId: T, actorUserId: U, warehouseId: W1, pallets: [
      { columnCode: "C1", positionNo: 5, repeat: 3, lines: [{ variantId: V2, batchNumber: "g1", qty: 66 }, { variantId: V3, batchNumber: "g1", qty: 30 }] },
      { columnCode: null, positionNo: null, repeat: 1, lines: [{ variantId: V2, batchNumber: "G1", qty: 10 }] },
    ],
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.equal(r.palletNos.length, 4);
  // «g1» و «G1» یک lot است (همان کلیدِ ایمپورت)
  const l2 = (await lotOf(V2, "G1"))!, l3 = (await lotOf(V3, "G1"))!;
  assert.equal(await onHand(l2), 66 * 3 + 10);
  assert.equal(await onHand(l3), 30 * 3);
  const ps = await Promise.all(r.palletNos.map(palletByNo));
  assert.deepEqual(ps.map((p) => [p.columnCode, p.positionNo, p.totalBoxes, p.lines.length]),
    [["C1", 5, 96, 2], ["C1", 6, 96, 2], ["C1", 7, 96, 2], [null, null, 10, 1]]);
  const [ledger] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM inventory_transaction WHERE transaction_type = 'goods_in' AND reference_id = ${r.receiptId}`;
  assert.equal(ledger.n, 2, "یک ردیفِ لجر برای هر lot");
  await assertInvariant();
});

test("ورود کالا: انبار و کالای tenantِ دیگر، و ردیفِ تکراری روی یک پالت، رد می‌شوند", async () => {
  const base = { tenantId: T, actorUserId: U };
  const line = { variantId: V2, batchNumber: "x", qty: 1 };
  assert.deepEqual(await goodsIn({ ...base, warehouseId: "a3333333-3333-3333-3333-33333333333b", pallets: [{ repeat: 1, lines: [line] }] }),
    { ok: false, reason: "warehouse_not_found" });
  const r = await goodsIn({ ...base, warehouseId: W1, pallets: [{ repeat: 1, lines: [{ ...line, variantId: "a2222222-2222-2222-2222-2222222222ff" }] }] });
  assert.equal(r.ok ? "" : r.reason, "unknown_variant");
  const d = await goodsIn({ ...base, warehouseId: W1, pallets: [{ repeat: 1, lines: [line, { ...line, batchNumber: " X " }] }] });
  assert.equal(d.ok ? "" : d.reason, "duplicate_line");
});

test("ورود کالا: track_shade_caliber=required شید را اجباری و off آن را نادیده می‌گیرد", async () => {
  const p = (shadeCode: string | null) => ({ tenantId: T, actorUserId: U, warehouseId: W2, pallets: [{ repeat: 1, lines: [{ variantId: V2, batchNumber: "s1", shadeCode, caliberCode: shadeCode, qty: 5 }] }] });
  await sql`UPDATE tenant SET track_shade_caliber = 'required' WHERE id = ${T}`;
  const r = await goodsIn(p(null));
  assert.equal(r.ok ? "" : r.reason, "missing_shade_caliber");
  await sql`UPDATE tenant SET track_shade_caliber = 'off' WHERE id = ${T}`;
  assert.equal((await goodsIn(p("S9"))).ok, true);
  const [lot] = await sql<{ shade_code: string | null }[]>`SELECT shade_code FROM inventory_lot WHERE warehouse_id = ${W2} AND batch_number = 's1'`;
  assert.equal(lot.shade_code, null);
  await sql`UPDATE tenant SET track_shade_caliber = 'optional' WHERE id = ${T}`;
});

test("ویرایش پالت: محل عوض می‌شود؛ تغییرِ تعداد دلیل می‌خواهد و on_hand و لجر را با هم عوض می‌کند", async () => {
  const { lot, palletNos } = await stock("e1", 50, 1);
  const p = await palletByNo(palletNos[0]);
  const base = { tenantId: T, actorUserId: U, palletId: p.id, columnCode: "Z", positionNo: 9 };
  assert.deepEqual(await editPallet({ ...base, lines: [{ lotId: lot, qty: 45 }] }), { ok: false, reason: "reason_required" });
  assert.deepEqual(await editPallet({ ...base, lines: [{ lotId: lot, qty: 45 }], reason: "other" }), { ok: false, reason: "reason_required" });
  assert.deepEqual(await editPallet({ ...base, lines: [{ lotId: lot, qty: 45 }], reason: "count_correction" }), { ok: true });
  assert.equal(await onHand(lot), 45);
  const after = await palletByNo(palletNos[0]);
  assert.deepEqual([after.columnCode, after.positionNo, after.totalBoxes], ["Z", 9, 45]);
  const [a] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM audit_log WHERE action = 'pallet.edit' AND entity_id = ${p.id}`;
  assert.equal(a.n, 1);
  await assertInvariant();
});

test("ویرایش و خروج on_hand را زیرِ heldِ رزروِ زنده نمی‌برند", async () => {
  const { lot, palletNos } = await stock("h1", 20, 1);
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "h1", items: [{ lotId: lot, quantityBoxes: 15 }] });
  assert.equal(r.ok, true);
  const p = await palletByNo(palletNos[0]);
  const e = await editPallet({ tenantId: T, actorUserId: U, palletId: p.id, columnCode: "A", positionNo: 1, lines: [{ lotId: lot, qty: 10 }], reason: "damage" });
  assert.equal(e.ok ? "" : e.reason, "below_committed");
  const x = await exitStock({ tenantId: T, actorUserId: U, palletId: p.id, lines: [{ lotId: lot, qty: 6 }], reason: "waste" });
  assert.equal(x.ok ? "" : x.reason, "below_committed");
  assert.deepEqual(await exitStock({ tenantId: T, actorUserId: U, palletId: p.id, lines: [{ lotId: lot, qty: 5 }], reason: "waste" }), { ok: true });
  assert.equal(await onHand(lot), 15);
  await assertInvariant();
});

test("انتقال: کلِ پالت فقط محل را عوض می‌کند؛ بخشی از آن پالتِ تازه می‌سازد و on_hand ثابت می‌ماند", async () => {
  const { lot, palletNos } = await stock("t1", 40, 1);
  const p = await palletByNo(palletNos[0]);
  assert.deepEqual(await transferPallet({ tenantId: T, actorUserId: U, palletId: p.id, columnCode: "B", positionNo: 2 }), { ok: true, newPalletNo: undefined });
  const split = await transferPallet({ tenantId: T, actorUserId: U, palletId: p.id, columnCode: "C", positionNo: 3, lines: [{ lotId: lot, qty: 15 }] });
  assert.equal(split.ok, true);
  if (!split.ok) return;
  const [src, dst] = [await palletByNo(palletNos[0]), await palletByNo(split.newPalletNo!)];
  assert.deepEqual([src.columnCode, src.totalBoxes, dst.columnCode, dst.positionNo, dst.totalBoxes], ["B", 25, "C", 3, 15]);
  assert.equal(await onHand(lot), 40);
  const over = await transferPallet({ tenantId: T, actorUserId: U, palletId: p.id, columnCode: "C", positionNo: 3, lines: [{ lotId: lot, qty: 26 }] });
  assert.equal(over.ok ? "" : over.reason, "exceeds_pallet");
  await assertInvariant();
});

test("خروج غیرفروش: on_hand و پالت کم می‌شوند، لجرِ stock_exit با دلیل؛ «سایر» بدون توضیح رد می‌شود", async () => {
  const { lot, palletNos } = await stock("x1", 12, 1);
  const p = await palletByNo(palletNos[0]);
  assert.deepEqual(await exitStock({ tenantId: T, actorUserId: U, palletId: p.id, lines: [{ lotId: lot, qty: 2 }], reason: "other" }), { ok: false, reason: "reason_required" });
  const big = await exitStock({ tenantId: T, actorUserId: U, palletId: p.id, lines: [{ lotId: lot, qty: 13 }], reason: "sample" });
  assert.equal(big.ok ? "" : big.reason, "exceeds_pallet");
  assert.deepEqual(await exitStock({ tenantId: T, actorUserId: U, palletId: p.id, lines: [{ lotId: lot, qty: 12 }], reason: "breakage", note: "افتاد" }), { ok: true });
  assert.equal(await onHand(lot), 0);
  assert.equal((await palletByNo(palletNos[0])).status, "exited", "پالتِ خالی برای سابقه می‌ماند");
  const ex = (await listExits({ tenantId: T })).find((e) => e.palletNo === palletNos[0])!;
  assert.deepEqual([ex.qty, ex.reason, ex.note], [12, "breakage", "افتاد"]);
  await assertInvariant();
});

test("بارگیری کارتن را از قدیمی‌ترین پالتِ lot کم می‌کند", async () => {
  const { lot, palletNos } = await stock("l1", 10, 3);
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "l1", items: [{ lotId: lot, quantityBoxes: 15 }] });
  const a = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  const d = await createDispatchFromRequest({ tenantId: T, salesRequestId: a.ok ? a.salesRequestId : "", createdByUserId: U, dispatchCode: "L-1" });
  const id = d.ok ? d.dispatchIds[0] : "";
  await setDispatchStatus({ tenantId: T, dispatchId: id, toStatus: "ready_for_loading", actorUserId: U });
  assert.equal((await setDispatchStatus({ tenantId: T, dispatchId: id, toStatus: "loaded", actorUserId: U })).ok, true);
  const ps = await Promise.all(palletNos.map(palletByNo));
  assert.deepEqual(ps.map((p) => p.totalBoxes), [0, 5, 10]);
  assert.equal(await onHand(lot), 15);
  await assertInvariant();
});

test("ناوردا در دیتابیس: نوشتنِ مستقیم با نقشِ اپ که پالت و on_hand را ناتراز کند رد می‌شود", async () => {
  const { lot } = await stock("db1", 30, 1);
  const asApp = (q: (tx: import("postgres").TransactionSql) => Promise<unknown>) =>
    appSql.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${T}, true)`; await q(tx); });
  await assert.rejects(asApp((tx) => tx`UPDATE inventory_balance SET on_hand_qty_boxes = on_hand_qty_boxes + 1 WHERE lot_id = ${lot}`), /pallet_sum_mismatch/);
  await assert.rejects(asApp((tx) => tx`UPDATE pallet_item SET qty_boxes = qty_boxes - 1 WHERE lot_id = ${lot}`), /pallet_sum_mismatch/);
  await assert.rejects(asApp((tx) => tx`DELETE FROM pallet_item WHERE lot_id = ${lot}`), /pallet_sum_mismatch/);
  // هر دو با هم: تراز است و پذیرفته می‌شود (deferred، فقط حالتِ آخرِ تراکنش مهم است)
  await asApp(async (tx) => {
    await tx`UPDATE inventory_balance SET on_hand_qty_boxes = on_hand_qty_boxes + 1 WHERE lot_id = ${lot}`;
    await tx`UPDATE pallet_item SET qty_boxes = qty_boxes + 1 WHERE lot_id = ${lot}`;
    await tx`INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes) VALUES (${T}, ${lot}, 'adjustment', 1)`;
  });
  assert.equal(await onHand(lot), 31);
  // پالت و lot در دو انبار: FK ترکیبی
  const [p2] = await sql<{ id: string }[]>`INSERT INTO pallet (tenant_id, warehouse_id) VALUES (${T}, ${W2}) RETURNING id`;
  await assert.rejects(sql`INSERT INTO pallet_item (tenant_id, pallet_id, lot_id, warehouse_id, qty_boxes) VALUES (${T}, ${p2.id}, ${lot}, ${W2}, 1)`, /foreign key/);
  await assertInvariant();
});

test("RLS: پالت و جمعِ موجودیِ tenantِ دیگر دیده نمی‌شود", async () => {
  assert.equal((await listPallets({ tenantId: TB, status: "all" })).length, 0);
  assert.equal((await stockSummary({ tenantId: TB })).length, 0);
  const [n] = await appSql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TB}, true)`;
    return tx<{ n: number }[]>`SELECT (SELECT count(*) FROM pallet)::int + (SELECT count(*) FROM pallet_item)::int AS n`;
  });
  assert.equal(n.n, 0);
});

test("جمع موجودی: held از رزروِ زنده و available = on_hand − held − allocated − blocked", async () => {
  const rows = (await stockSummary({ tenantId: T, warehouseId: W1 })).filter((r) => r.variantId === V2);
  assert.equal(rows.length, 1);
  const s = rows[0];
  assert.equal(s.available, s.onHand - s.held - s.allocated - s.blocked);
  const [direct] = await sql<{ q: number }[]>`
    SELECT SUM(b.on_hand_qty_boxes)::int AS q FROM inventory_balance b JOIN inventory_lot l ON l.id = b.lot_id
    WHERE l.variant_id = ${V2} AND l.warehouse_id = ${W1}`;
  assert.equal(s.onHand, direct.q);
  assert.ok(s.held >= 15, "رزروِ ۱۵ کارتنیِ تستِ قبل");
});

test("هم‌زمانی پالت: ۱۲ خروجِ ۱۰ کارتنی روی ۱۰۰ کارتن با ۶۰ رزرو، کنارِ انتقال و ورود", async () => {
  for (let round = 0; round < 3; round++) {
    const { lot, palletNos } = await stock(`cc${round}`, 20, 5, `CC${round}`);
    const ps = await Promise.all(palletNos.map(palletByNo));
    const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: `cc${round}`, items: [{ lotId: lot, quantityBoxes: 60 }] });
    assert.equal(r.ok, true);
    const results = await Promise.all([
      ...Array.from({ length: 12 }, (_, i) =>
        exitStock({ tenantId: T, actorUserId: U, palletId: ps[i % 5].id, lines: [{ lotId: lot, qty: 10 }], reason: "waste" })),
      ...ps.map((p, i) => transferPallet({ tenantId: T, actorUserId: U, palletId: p.id, columnCode: `M${round}`, positionNo: i + 1, lines: [{ lotId: lot, qty: 1 }] })),
      goodsIn({ tenantId: T, actorUserId: U, warehouseId: W1, pallets: [{ columnCode: `CC${round}`, positionNo: 9, repeat: 1, lines: [{ variantId: V2, batchNumber: `cc${round}`, qty: 0 + 7 }] }] }),
    ]);
    const exits = results.slice(0, 12) as Awaited<ReturnType<typeof exitStock>>[];
    const okExits = exits.filter((x) => x.ok).length;
    for (const x of exits) if (!x.ok) assert.ok(["below_committed", "exceeds_pallet", "unknown_line"].includes(x.reason), JSON.stringify(x));
    const [b] = await sql<{ on_hand: number; committed: number }[]>`
      SELECT on_hand_qty_boxes AS on_hand, allocated_qty_boxes + blocked_qty_boxes AS committed FROM inventory_balance WHERE lot_id = ${lot}`;
    const [{ held }] = await sql<{ held: number }[]>`
      SELECT COALESCE(SUM(ri.quantity_boxes), 0)::int AS held FROM reservation_item ri JOIN reservation r ON r.id = ri.reservation_id
      WHERE ri.lot_id = ${lot} AND r.status = 'active' AND r.expires_at > now()`;
    assert.ok(b.on_hand - held - b.committed >= 0, `دور ${round}: available منفی شد (on_hand ${b.on_hand}، held ${held})`);
    assert.equal(b.on_hand, 100 + 7 - okExits * 10, `دور ${round}: on_hand با خروج‌های موفق نمی‌خواند`);
    assert.ok(okExits <= 4, `دور ${round}: ${okExits} خروجِ ۱۰تایی از ۴۰ کارتنِ آزاد (+۷ ورود) موفق شد`);
    await assertInvariant();
  }
});

test("هم‌زمانی پالت: بارگیری و خروج و ویرایش روی پالتِ ترکیبی با ترتیبِ مخالفِ lotها بن‌بست نمی‌سازد", async () => {
  const g = await goodsIn({ tenantId: T, actorUserId: U, warehouseId: W1, pallets: [{ columnCode: "MX", positionNo: 1, repeat: 4,
    lines: [{ variantId: V2, batchNumber: "mx", qty: 30 }, { variantId: V3, batchNumber: "mx", qty: 30 }] }] });
  assert.equal(g.ok, true);
  if (!g.ok) return;
  const [la, lb] = [(await lotOf(V2, "mx"))!, (await lotOf(V3, "mx"))!];
  const ps = await Promise.all(g.palletNos.map(palletByNo));
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "mx", items: [{ lotId: la, quantityBoxes: 20 }, { lotId: lb, quantityBoxes: 20 }] });
  const a = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  const d = await createDispatchFromRequest({ tenantId: T, salesRequestId: a.ok ? a.salesRequestId : "", createdByUserId: U, dispatchCode: "MX-1" });
  const did = d.ok ? d.dispatchIds[0] : "";
  await setDispatchStatus({ tenantId: T, dispatchId: did, toStatus: "ready_for_loading", actorUserId: U });
  const results = await Promise.all([
    setDispatchStatus({ tenantId: T, dispatchId: did, toStatus: "loaded", actorUserId: U }),
    ...ps.map((p, i) => exitStock({ tenantId: T, actorUserId: U, palletId: p.id, reason: "sample",
      lines: i % 2 ? [{ lotId: lb, qty: 3 }, { lotId: la, qty: 3 }] : [{ lotId: la, qty: 3 }, { lotId: lb, qty: 3 }] })),
    ...ps.map((p) => editPallet({ tenantId: T, actorUserId: U, palletId: p.id, columnCode: "MY", positionNo: 2, lines: [] })),
  ]);
  assert.equal(results[0].ok, true, "بارگیری");
  assert.equal(await onHand(la), 120 - 20 - results.slice(1, 5).filter((x) => x.ok).length * 3);
  await assertInvariant();
});

test("migration 0009: موجودیِ قبلی پالتِ «بدون محل» می‌گیرد، تریگر برمی‌گردد و اجرای دوباره بی‌اثر است", async () => {
  const { readFileSync } = await import("node:fs");
  const mig = readFileSync(new URL("../../../db/migrations/0009_pallets.sql", import.meta.url), "utf8")
    .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
  // حالتِ قبل از فاز ۷: موجودی بدون پالت و بدون تریگر
  await sql.unsafe(`
    DROP TRIGGER balance_pallet_sum ON inventory_balance; DROP TRIGGER pallet_item_sum ON pallet_item;
    DELETE FROM pallet_item; DELETE FROM pallet;`);
  const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM inventory_balance WHERE on_hand_qty_boxes > 0`;
  await sql.unsafe(mig);
  await sql.unsafe(mig);
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pallet WHERE column_code IS NULL`;
  assert.equal(n, before[0].n, "یک پالت برای هر lotِ دارای موجودی، حتی با دو بار اجرا");
  for (const r of await invariant()) assert.equal(r.pallets, r.on_hand);
  const [{ t }] = await sql<{ t: number }[]>`SELECT count(*)::int AS t FROM pg_trigger WHERE tgname IN ('balance_pallet_sum', 'pallet_item_sum')`;
  assert.equal(t, 2);
  const [{ forced }] = await sql<{ forced: number }[]>`
    SELECT count(*)::int AS forced FROM pg_class WHERE relname IN ('pallet', 'pallet_item') AND relrowsecurity AND relforcerowsecurity`;
  assert.equal(forced, 2);
});
