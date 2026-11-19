import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { sql, resetSchema, ALIGN_PALLETS, withAlignedPallets } from "./_testdb";
import { T, U, seedTenantUser } from "./_fixtures";
import * as imports from "./imports";
import { reserve } from "./reservations";

/**
 * فاز ۵: هر فایلِ خراب یا رد می‌شود یا فقط پیش‌نمایش می‌گیرد، و موجودی دست نمی‌خورد.
 * ممیزی blocker ۲ و E3-F2/F3. هر تست اول وضعیتِ کاملِ موجودی را مقایسه می‌کند تا روی
 * کدِ قبلی قرمزی‌اش از دست رفتنِ موجودی باشد، نه از شکلِ پاسخ.
 */

const T2 = "22222222-2222-2222-2222-222222222222";
const P1 = "a1111111-1111-1111-1111-111111111111", P2 = "a1111111-1111-1111-1111-111111111112";
const S1 = "a2222222-2222-2222-2222-222222222221", S2 = "a2222222-2222-2222-2222-222222222222";
const WA = "aaaaaaa1-0000-0000-0000-000000000001", WB = "aaaaaaa2-0000-0000-0000-000000000002";
const WX = "aaaaaaa9-0000-0000-0000-000000000009"; // انبارِ tenantِ دیگر
const L1 = "bbbbbbb1-0000-0000-0000-000000000001", L2 = "bbbbbbb2-0000-0000-0000-000000000002";
const L3 = "bbbbbbb3-0000-0000-0000-000000000003", L4 = "bbbbbbb4-0000-0000-0000-000000000004";
const AG = "c1111111-1111-1111-1111-111111111111";

beforeEach(async () => {
  await resetSchema();
  await seedTenantUser();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T2}','B','b');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WX}','${T2}','WX','A','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('${P1}','${T}','P1','P1'), ('${P2}','${T}','P2','P2');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${S1}','${T}','${P1}','S1'), ('${S2}','${T}','${P2}','S2');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WA}','${T}','WA','A','main'), ('${WB}','${T}','WB','B','main');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id,batch_number) VALUES
      ('${L1}','${T}','${S1}','${WA}','B1'), ('${L2}','${T}','${S1}','${WA}','B2'),
      ('${L3}','${T}','${S2}','${WA}','B1'), ('${L4}','${T}','${S1}','${WB}','B1');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES
      ('${T}','${L1}',100), ('${T}','${L2}',100), ('${T}','${L3}',100), ('${T}','${L4}',100);
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
  ${ALIGN_PALLETS}`);
});

/** همه چیزی که یک ایمپورتِ ردشده نباید عوض کند. */
async function state() {
  const bal = await sql`SELECT lot_id, on_hand_qty_boxes AS h, allocated_qty_boxes AS a FROM inventory_balance ORDER BY lot_id`;
  const [{ tx, batches, lots, products }] = await sql`
    SELECT (SELECT count(*)::int FROM inventory_transaction) AS tx,
           (SELECT count(*)::int FROM import_batch) AS batches,
           (SELECT count(*)::int FROM inventory_lot) AS lots,
           (SELECT count(*)::int FROM product) AS products`;
  return { bal: bal.map((b) => `${b.lot_id}:${b.h}/${b.a}`), tx, batches, lots, products };
}
const onHand = async (lot: string) =>
  Number((await sql`SELECT on_hand_qty_boxes AS v FROM inventory_balance WHERE lot_id = ${lot}`)[0].v);

let n = 0;
type Rows = Record<string, unknown>[];
const run = (rows: Rows, o: { preview?: boolean; scope?: imports.ImportScope; key?: string } = {}) =>
  imports.applySnapshot({
    tenantId: T, uploaderUserId: U, idempotencyKey: o.key ?? `k${++n}`,
    scope: o.scope ?? { type: "warehouse", warehouseId: WA }, rows, preview: o.preview,
  } as Parameters<typeof imports.applySnapshot>[0]);

const row = (sku: string, batch: string, onHand: unknown, wh = "A"): Record<string, unknown> =>
  ({ sku, warehouseCode: wh, batchNumber: batch, onHand });
/** فایلِ سالم برای انبارِ A؛ هر تست یک ردیفش را خراب می‌کند */
const good = (): Rows => [row("S1", "B1", 90), row("S1", "B2", 80), row("S2", "B1", 70)];

async function rejected(rows: Rows, reason: string, o?: Parameters<typeof run>[1]) {
  const before = await state();
  const res = await run(rows, o);
  assert.deepEqual(await state(), before, "موجودی، لجر یا lot نباید عوض شود");
  assert.equal(res.ok, false, "ایمپورت باید رد شود");
  assert.ok(res.errors.some((e) => e.reason === reason), `خطای ${reason} لازم است: ${JSON.stringify(res.errors)}`);
  return res;
}

// ── فایل‌های خراب ──

test("کدِ کالای غلط در یک ردیف: کلِ فایل رد، lotِ آن ردیف صفر نمی‌شود (ممیزی S3)", async () => {
  const rows = good(); rows[1].sku = "S1x";
  await rejected(rows, "unknown_sku");
});

test("عددِ اعشاری ۱۲٫۵: رد", async () => {
  const rows = good(); rows[1].onHand = 12.5;
  await rejected(rows, "bad_quantity");
});

test("سلولِ موجودیِ خالی: خطا، نه صفر", async () => {
  const rows = good(); delete rows[1].onHand;
  await rejected(rows, "missing_quantity");
});

test("رشته‌ی خالی در موجودی: خطا، نه صفر", async () => {
  const rows = good(); rows[1].onHand = "  ";
  await rejected(rows, "missing_quantity");
});

test("ستونِ موجودی در کلِ فایل نیست (هدرِ غلط): رد", async () => {
  const rows = good().map(({ onHand, ...r }) => ({ ...r, "موجودیی": onHand }));
  await rejected(rows, "missing_quantity");
});

test("\"1,5\" پانزده نمی‌شود: رد", async () => {
  const rows = good(); rows[1].onHand = "1,5";
  await rejected(rows, "bad_quantity");
});

test("موجودیِ منفی و متنِ «۱۲ کارتن»: رد", async () => {
  const rows = good(); rows[1].onHand = "-5"; rows[2].onHand = "۱۲ کارتن";
  const res = await rejected(rows, "bad_quantity");
  assert.equal(res.errors.filter((e) => e.reason === "bad_quantity").length, 2);
});

test("عددِ خارج از INT: خطای ردیف، نه ۵۰۰", async () => {
  const rows = good(); rows[1].onHand = 1e12;
  await rejected(rows, "bad_quantity");
});

test("ردیفِ بی‌کد: خطا، نه حذفِ بی‌صدا", async () => {
  const rows = good(); rows.push({ warehouseCode: "A", batchNumber: "B9", onHand: 5 });
  await rejected(rows, "missing_sku");
});

test("ردیفِ انبارِ دیگر در فایلِ یک انبار: رد", async () => {
  const rows = good(); rows.push(row("S1", "B1", 5, "B"));
  await rejected(rows, "out_of_scope");
});

test("دو ردیف برای یک lot با دو عددِ متفاوت: رد", async () => {
  const rows = good(); rows.push(row("S1", "B1", 55));
  await rejected(rows, "duplicate_row");
});

test("فایلِ خالی کلِ انبار را صفر نمی‌کند", async () => {
  await rejected([], "empty_file");
});

test("E3-F3: on_hand زیرِ heldِ رزروِ زنده نمی‌رود", async () => {
  await sql.unsafe(`
    INSERT INTO reservation (id,tenant_id,agent_account_id,expires_at) VALUES ('d1111111-0000-0000-0000-000000000001','${T}','${AG}', now() + interval '1 day');
    INSERT INTO reservation_item (tenant_id,reservation_id,lot_id,quantity_boxes) VALUES ('${T}','d1111111-0000-0000-0000-000000000001','${L1}',50);`);
  const rows = good(); rows[0].onHand = 20;
  await rejected(rows, "below_committed");
});

test("E3-F3 هم‌زمان: ایمپورت و رزروِ موازی، on_hand هرگز زیرِ held نمی‌رود", async () => {
  for (let i = 0; i < 8; i++) {
    await sql`DELETE FROM reservation_item`; await sql`DELETE FROM reservation`;
    await withAlignedPallets((tx) => tx`UPDATE inventory_balance SET on_hand_qty_boxes = 100 WHERE lot_id = ${L1}`);
    const rows = good(); rows[0].onHand = 40;
    await Promise.all([
      run(rows),
      reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: `race${i}`, items: [{ lotId: L1, quantityBoxes: 70 }] }),
    ]);
    const [{ h, held }] = await sql`
      SELECT b.on_hand_qty_boxes AS h, COALESCE((SELECT SUM(quantity_boxes) FROM reservation_item WHERE lot_id = ${L1}), 0)::int AS held
      FROM inventory_balance b WHERE b.lot_id = ${L1}`;
    assert.ok(h >= held, `دور ${i}: on_hand ${h} < held ${held}`);
  }
});

test("رزروِ منقضی‌شده جلوی ایمپورت را نمی‌گیرد", async () => {
  await sql.unsafe(`
    INSERT INTO reservation (id,tenant_id,agent_account_id,created_at,expires_at) VALUES ('d1111111-0000-0000-0000-000000000002','${T}','${AG}', now() - interval '2 day', now() - interval '1 day');
    INSERT INTO reservation_item (tenant_id,reservation_id,lot_id,quantity_boxes) VALUES ('${T}','d1111111-0000-0000-0000-000000000002','${L1}',50);`);
  const rows = good(); rows[0].onHand = 20;
  const res = await run(rows);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(await onHand(L1), 20);
});

test("lotِ دارای تخصیص که در فایل نیست: کلِ فایل رد، بقیه هم اعمال نمی‌شوند", async () => {
  await sql`UPDATE inventory_balance SET allocated_qty_boxes = 10 WHERE lot_id = ${L3}`;
  await rejected(good().slice(0, 2), "absent_but_committed");
});

test("انبارِ tenantِ دیگر به‌عنوانِ scope: خطا، نه ۵۰۰", async () => {
  await rejected(good(), "scope_not_found", { scope: { type: "warehouse", warehouseId: WX } });
});

test("دو lot با یک کلید: رد، نه انتخابِ دلبخواه", async () => {
  await sql.unsafe(`
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id,batch_number) VALUES ('bbbbbbb9-0000-0000-0000-000000000009','${T}','${S1}','${WA}','B1');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','bbbbbbb9-0000-0000-0000-000000000009',100);${ALIGN_PALLETS}`);
  await rejected(good(), "ambiguous_lot");
});

test("track_shade_caliber=required: ردیفِ بی‌شید رد", async () => {
  await sql`UPDATE tenant SET track_shade_caliber = 'required' WHERE id = ${T}`;
  await rejected(good(), "missing_shade_caliber");
});

test("track_shade_caliber=off: شیدِ فایل نادیده، همان lot پیدا می‌شود", async () => {
  await sql`UPDATE tenant SET track_shade_caliber = 'off' WHERE id = ${T}`;
  const rows = good().map((r) => ({ ...r, shadeCode: "SH1" }));
  const res = await run(rows);
  assert.equal(await onHand(L1), 90, "همان lotِ قبلی، نه lotِ تازه با شید");
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.newLots, 0);
});

test("فایلِ واقعیِ xlsx با سلولِ خالی و کدِ غلط: رد، و شماره‌ی ردیفِ اکسل در خطا", async () => {
  const ws = XLSX.utils.aoa_to_sheet([
    ["کد", "انبار", "بچ", "موجودی"],
    ["S1", "A", "B1", 90],
    ["S1", "A", "B2", null],
    ["S2x", "A", "B1", 70],
  ]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "s");
  // پویا: روی کدِ قبلی این ماژول نیست و نباید کلِ فایل را از کار بیندازد
  const { sheetRows } = await import("@/lib/importRows");
  const rows = sheetRows(XLSX, XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  const res = await rejected(rows, "missing_quantity");
  assert.deepEqual(res.errors.map((e) => [e.row, e.reason]).sort(), [[3, "missing_quantity"], [4, "unknown_sku"]]);
});

// ── فایل‌های درست که قبلاً خراب خوانده می‌شدند ──

test("رقمِ فارسی و جداکننده‌ی هزارگان خوانده می‌شوند", async () => {
  const res = await run([row("S1", "B1", "۹۰"), row("S1", "B2", "1,200"), row("S2", "B1", "۱٬۵۰۰")]);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.deepEqual([await onHand(L1), await onHand(L2), await onHand(L3)], [90, 1200, 1500]);
});

test("هدرِ فارسی، با ي و ك عربی و نیم‌فاصله", async () => {
  const res = await run([
    // یک ردیفِ هدر، مثلِ هر شیتِ واقعی: «موجودي» با ي عربی، «بچ‌نامبر» با نیم‌فاصله، «كد» با ك عربی
    { "كد": "S1", "انبار ": "A", "بچ‌نامبر": "B1", "موجودي": 90 },
    { "كد": "S1", "انبار ": "A", "بچ‌نامبر": "B2", "موجودي": 80 },
    { "كد": "S2", "انبار ": "A", "بچ‌نامبر": "B1", "موجودي": 70 },
  ]);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.deepEqual([await onHand(L1), await onHand(L2), await onHand(L3)], [90, 80, 70]);
});

// ── پیش‌نمایش ──

test("پیش‌نمایش هیچ چیزی نمی‌نویسد و تغییرها را نشان می‌دهد", async () => {
  const before = await state();
  const res = await run([row("S1", "B1", 90), row("S2", "B1", 100), row("S1", "B7", 5)], { preview: true });
  assert.deepEqual(await state(), before, "پیش‌نمایش نباید چیزی بنویسد");
  assert.equal(res.ok, true);
  assert.equal(res.preview, true);
  assert.equal(res.batchId, null);
  assert.equal(res.zeroed, 1, "L2 غایب است");
  assert.equal(res.newLots, 1);
  const byLot = new Map(res.changes.map((c) => [c.lotId ?? "new", [c.before, c.after]]));
  assert.deepEqual(byLot.get(L1), [100, 90]);
  assert.deepEqual(byLot.get(L2), [100, 0]);
  assert.deepEqual(byLot.get("new"), [0, 5]);
  assert.equal(byLot.has(L3), false, "بدون تغییر در فهرست نمی‌آید");
});

test("پیش‌نمایش کلید را مصرف نمی‌کند؛ اعمال با همان کلید کار می‌کند", async () => {
  await run(good(), { preview: true, key: "same" });
  const res = await run(good(), { key: "same" });
  assert.equal(res.ok, true);
  assert.equal(res.deduped, false);
  assert.equal(await onHand(L1), 90);
});

// ── برگرداندن ──

const undo = (batchId: string) =>
  (imports as unknown as { undoImport: (p: object) => Promise<{ ok: boolean; reason?: string }> })
    .undoImport({ tenantId: T, userId: U, batchId });

test("برگرداندن: موجودیِ قبل از ایمپورت برمی‌گردد، حتی lotِ صفرشده", async () => {
  const res = await run([row("S1", "B1", 90), row("S2", "B1", 100), row("S1", "B7", 5)]);
  assert.equal(res.ok, true);
  assert.equal(await onHand(L2), 0);
  const u = await undo(res.batchId!);
  assert.equal(u.ok, true);
  assert.deepEqual([await onHand(L1), await onHand(L2), await onHand(L3)], [100, 100, 100]);
  const [nl] = await sql`SELECT b.on_hand_qty_boxes AS v FROM inventory_lot l JOIN inventory_balance b ON b.lot_id = l.id WHERE l.batch_number = 'B7'`;
  assert.equal(Number(nl.v), 0, "lotِ تازه می‌ماند، با موجودیِ صفر");
  const [{ s }] = await sql`SELECT COALESCE(SUM(on_hand_delta_boxes), 0)::int AS s FROM inventory_transaction WHERE reference_id = ${res.batchId}`;
  assert.equal(s, 0, "لجرِ ایمپورت و برگشت با هم صفر می‌شوند");
  assert.equal((await undo(res.batchId!)).reason, "not_committed", "دو بار برنمی‌گردد");
});

test("برگرداندن تغییرهای بعد از ایمپورت را نگه می‌دارد", async () => {
  const res = await run(good());
  await withAlignedPallets((tx) => tx`UPDATE inventory_balance SET on_hand_qty_boxes = on_hand_qty_boxes - 5 WHERE lot_id = ${L1}`); // مثلاً بارگیری
  assert.equal((await undo(res.batchId!)).ok, true);
  assert.equal(await onHand(L1), 95);
});

test("برگرداندن on_hand را زیرِ heldِ زنده نمی‌برد", async () => {
  const res = await run([row("S1", "B1", 300), row("S1", "B2", 100), row("S2", "B1", 100)]);
  await sql.unsafe(`
    INSERT INTO reservation (id,tenant_id,agent_account_id,expires_at) VALUES ('d1111111-0000-0000-0000-000000000003','${T}','${AG}', now() + interval '1 day');
    INSERT INTO reservation_item (tenant_id,reservation_id,lot_id,quantity_boxes) VALUES ('${T}','d1111111-0000-0000-0000-000000000003','${L1}',250);`);
  const before = await state();
  const u = await undo(res.batchId!);
  assert.equal(u.ok, false);
  assert.equal(u.reason, "below_committed");
  assert.deepEqual(await state(), before);
});

test("فقط آخرین ایمپورت برمی‌گردد", async () => {
  const a = await run(good());
  await run([row("S1", "B1", 60), row("S1", "B2", 60), row("S2", "B1", 60)]);
  assert.equal((await undo(a.batchId!)).reason, "not_latest");
  assert.equal(await onHand(L1), 60);
});

// ── یافته‌های بازبین Opus فاز ۵ ──

test("دو ستون برای موجودی (موجودی و qty): کلِ فایل رد، نه ستونِ اول بی‌صدا", async () => {
  const rows = good().map(({ onHand, ...r }) => ({ ...r, "موجودی": onHand, qty: 5 }));
  delete rows[1]["موجودی"]; // سلولِ خالیِ ستونِ اول قبلاً ستونِ دوم را می‌خواند
  await rejected(rows, "duplicate_column");
});

test("«قابل سفارش» موجودی نیست: بدونِ ستونِ موجودی رد می‌شود", async () => {
  const rows = good().map(({ onHand, ...r }) => ({ ...r, "قابل سفارش": onHand }));
  await rejected(rows, "missing_quantity");
});

test("سلولِ تاریخ در ستونِ موجودی: خطا، نه ۴۶۰۳۷ کارتن", async () => {
  const ws = XLSX.utils.aoa_to_sheet([["sku", "warehouse", "batch", "qty"], ["S1", "A", "B1", 90], ["S1", "A", "B2", 80], ["S2", "A", "B1", 70]]);
  ws["D3"] = { t: "n", v: 46037, z: "yyyy-mm-dd" };
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "s");
  const { sheetRows } = await import("@/lib/importRows");
  const rows = JSON.parse(JSON.stringify(sheetRows(XLSX, XLSX.write(wb, { type: "array", bookType: "xlsx" })))); // مثلِ مرورگر
  await rejected(rows, "bad_quantity");
});

test("بچ با حروفِ کوچک و فاصله همان lot است", async () => {
  const res = await run([row("S1", " b1 ", 90), row("S1", "B2", 100), row("S2", "b1", 100)]);
  assert.equal(await onHand(L1), 90);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.newLots, 0);
});

test("lotِ تازه کنارِ lotِ صفرشونده‌ی همان کالا: هشدار در پیش‌نمایش", async () => {
  const res = await run([row("S1", "B1x", 100), row("S1", "B2", 100), row("S2", "B1", 100)], { preview: true });
  assert.equal(res.ok, true);
  assert.deepEqual(res.warnings.map((w) => [w.row, w.reason]), [[1, "new_lot_replaces"]]);
});

test("آدرسِ عکسِ javascript: رد", async () => {
  const rows = good(); rows[0].imageUrl = "javascript:alert(1)";
  await rejected(rows, "bad_image_url");
});

test("همان کلید با فایلِ دیگر: خطا، نه «قبلاً اعمال شد»", async () => {
  await run(good(), { key: "reuse" });
  const before = await state();
  const res = await run([row("S1", "B1", 10), row("S1", "B2", 10), row("S2", "B1", 10)], { key: "reuse" });
  assert.deepEqual(await state(), before);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.reason === "idempotency_mismatch"));
  assert.equal((await run(good(), { key: "reuse" })).deduped, true, "همان فایل با همان کلید هنوز dedupe است");
});

test("سه ایمپورتِ هم‌زمان با بچِ تازه: یک lot، نه سه", async () => {
  const file = [row("S1", "B1", 100), row("S1", "B2", 100), row("S2", "B1", 100), row("S1", "B9", 30)];
  const rs = await Promise.all([run(file), run(file), run(file)]);
  assert.ok(rs.every((r) => r.ok), JSON.stringify(rs.map((r) => r.errors)));
  const [{ c }] = await sql`SELECT count(*)::int AS c FROM inventory_lot WHERE batch_number = 'B9'`;
  assert.equal(c, 1);
});
