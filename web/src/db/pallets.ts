import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import { withTenant } from "./client";
import { writeAudit } from "./audit";
import { enqueueRestockNotifications } from "./alerts";

/**
 * پالت و انبار (فاز ۷). عدد موجودی همچنان on_hand در inventory_balance است؛ پالت فقط می‌گوید
 * کارتن‌های هر lot کجا هستند. ناوردا «جمعِ کارتنِ پالت‌های هر lot = on_hand» را تریگرِ deferredِ
 * `check_pallet_sum` در خودِ دیتابیس نگه می‌دارد. هر مسیری که on_hand یا ردیفِ پالت را عوض می‌کند،
 * اول ردیف‌های balance را به ترتیبِ lot_id قفل می‌کند (قانون ۴)؛ پس ترتیبِ قفل همه‌جا:
 * balance، بعد پالت، بعد ردیفِ پالت.
 */

export type LotQty = { lotId: string; qty: number };
/** ردیفِ ویرایش: `expected` همان تعدادی است که فرم دیده بود. ویرایش مطلق است، پس بدون آن فرمِ کهنه کارتنِ خارج‌شده را برمی‌گرداند. */
export type EditLine = LotQty & { expected: number };

const hasDupLots = (lines: LotQty[]) => new Set(lines.map((l) => l.lotId)).size !== lines.length;

/** held زنده‌ی هر lot (همان SUMِ reservations.ts)، بعد از قفلِ balance. تعهد = allocated + blocked + held. */
export async function heldOf(tx: TransactionSql, tenantId: string, lotIds: string[]) {
  if (lotIds.length === 0) return new Map<string, number>();
  const rows = await tx<{ lot_id: string; held: number }[]>`
    SELECT ri.lot_id, SUM(ri.quantity_boxes)::int AS held
    FROM reservation_item ri JOIN reservation r ON r.id = ri.reservation_id
    WHERE ri.tenant_id = ${tenantId} AND ri.lot_id = ANY(${lotIds}::uuid[])
      AND r.status = 'active' AND r.expires_at > now()
    GROUP BY ri.lot_id`;
  return new Map(rows.map((r) => [r.lot_id, r.held]));
}

type LockedBalance = { lot_id: string; on_hand: number; committed: number };

/** قفلِ balanceها به ترتیبِ lot_id و تعهدِ زنده‌ی هر کدام (allocated + blocked + held). */
async function lockBalances(tx: TransactionSql, tenantId: string, lotIds: string[]) {
  const ids = [...new Set(lotIds)];
  if (ids.length === 0) return new Map<string, LockedBalance>();
  const rows = await tx<LockedBalance[]>`
    SELECT lot_id, on_hand_qty_boxes AS on_hand, allocated_qty_boxes + blocked_qty_boxes AS committed
    FROM inventory_balance WHERE tenant_id = ${tenantId} AND lot_id = ANY(${ids}::uuid[])
    ORDER BY lot_id FOR UPDATE`;
  const held = await heldOf(tx, tenantId, ids);
  for (const r of rows) r.committed += held.get(r.lot_id) ?? 0;
  return new Map(rows.map((r) => [r.lot_id, r]));
}

/**
 * کارتنِ تازه‌ی مسیرهای خودکار (ایمپورت، رسیدنِ محموله، موجودیِ اولیه، برگرداندنِ ایمپورت):
 * برای هر lot یک پالتِ «بدون محل». کارمند بعداً با «انتقال» جایش را تعیین و تقسیمش می‌کند.
 * صدازننده باید balanceها را قفل کرده باشد.
 */
export async function addUnplacedPallets(tx: TransactionSql, tenantId: string, rows: LotQty[], note: string, actorUserId: string | null) {
  const r = rows.filter((x) => x.qty > 0);
  if (r.length === 0) return;
  const ids = r.map(() => randomUUID()), lots = r.map((x) => x.lotId), qs = r.map((x) => x.qty);
  // دو دستورِ جدا، نه یک CTE: وقتی پالت و ردیفش در یک دستور ساخته می‌شوند، چکِ FKِ ردیف به پالت
  // برای ۵۰۰۰ ردیف ۱۰ ثانیه طول کشید (seq scan روی پالت‌های همان دستور)؛ جدا ۰٫۴ ثانیه.
  await tx`
    INSERT INTO pallet (id, tenant_id, warehouse_id, note, created_by)
    SELECT v.id, ${tenantId}::uuid, l.warehouse_id, ${note}, ${actorUserId}::uuid
    FROM unnest(${ids}::uuid[], ${lots}::uuid[]) AS v(id, lot_id)
    JOIN inventory_lot l ON l.id = v.lot_id AND l.tenant_id = ${tenantId}`;
  await tx`
    INSERT INTO pallet_item (tenant_id, pallet_id, lot_id, warehouse_id, qty_boxes)
    SELECT ${tenantId}::uuid, v.id, v.lot_id, l.warehouse_id, v.q
    FROM unnest(${ids}::uuid[], ${lots}::uuid[], ${qs}::int[]) AS v(id, lot_id, q)
    JOIN inventory_lot l ON l.id = v.lot_id AND l.tenant_id = ${tenantId}`;
}

/**
 * کم کردن کارتن از پالت‌های lot، از قدیمی‌ترین پالت (pallet_no). مسیرهایی که پالتِ مشخص ندارند:
 * بارگیری (تا فاز ۹ که انتخابِ پالت روی حواله می‌آید)، ایمپورتِ کاهشی و برگرداندنِ ایمپورت.
 * صدازننده باید balanceها را قفل کرده باشد.
 */
export async function takeFromPallets(tx: TransactionSql, tenantId: string, rows: LotQty[]) {
  const r = rows.filter((x) => x.qty > 0);
  if (r.length === 0) return;
  const cut = await tx<{ id: string; qty_boxes: number; rm: number }[]>`
    WITH d AS (SELECT * FROM unnest(${r.map((x) => x.lotId)}::uuid[], ${r.map((x) => x.qty)}::int[]) AS d(lot_id, take)),
    items AS (
      SELECT pi.id, pi.qty_boxes, d.take,
             SUM(pi.qty_boxes) OVER (PARTITION BY pi.lot_id ORDER BY p.pallet_no, pi.id) AS cum
      FROM pallet_item pi JOIN pallet p ON p.id = pi.pallet_id JOIN d ON d.lot_id = pi.lot_id
      WHERE pi.tenant_id = ${tenantId}
    )
    SELECT id, qty_boxes, LEAST(qty_boxes, take - (cum - qty_boxes))::int AS rm
    FROM items WHERE cum - qty_boxes < take`;
  await applyCuts(tx, cut);
}

async function applyCuts(tx: TransactionSql, cut: { id: string; qty_boxes: number; rm: number }[]) {
  const gone = cut.filter((c) => c.rm >= c.qty_boxes).map((c) => c.id);
  const part = cut.filter((c) => c.rm < c.qty_boxes && c.rm > 0);
  if (gone.length) await tx`DELETE FROM pallet_item WHERE id = ANY(${gone}::uuid[])`;
  if (part.length) await tx`
    UPDATE pallet_item x SET qty_boxes = x.qty_boxes - v.rm
    FROM unnest(${part.map((c) => c.id)}::uuid[], ${part.map((c) => c.rm)}::int[]) AS v(id, rm)
    WHERE x.id = v.id`;
}

/** تغییرِ خالص on_hand هر lot روی پالت‌ها: مثبت پالتِ بدون محل، منفی از قدیمی‌ترین پالت. */
export async function applyPalletDeltas(tx: TransactionSql, tenantId: string, deltas: LotQty[], note: string, actorUserId: string | null) {
  await takeFromPallets(tx, tenantId, deltas.filter((d) => d.qty < 0).map((d) => ({ lotId: d.lotId, qty: -d.qty })));
  await addUnplacedPallets(tx, tenantId, deltas.filter((d) => d.qty > 0), note, actorUserId);
}

// ─────────────────────────────────────────────────────────────────────────────
// ورود کالا
// ─────────────────────────────────────────────────────────────────────────────

const nk = (v: string | null | undefined) => (v == null || v.trim() === "" ? null : v.trim().toUpperCase());

export type GoodsInLine = { variantId: string; batchNumber?: string | null; shadeCode?: string | null; caliberCode?: string | null; qty: number };
export type GoodsInPallet = { columnCode?: string | null; positionNo?: number | null; repeat: number; note?: string | null; lines: GoodsInLine[] };
export type GoodsInResult =
  | { ok: true; receiptId: string; palletNos: number[]; notified: number }
  | { ok: false; reason: "warehouse_not_found" | "unknown_variant" | "missing_shade_caliber" | "ambiguous_lot" | "duplicate_line"; detail?: string };

/**
 * ورودِ کالا: چند پالت در یک فرم، هر پالت یک یا چند ردیف (پالتِ ترکیبی = چند درجه/کالا روی یک پالت)
 * و «تکرار ×n» برای n پالتِ یکسان. با شماره‌ی محل، پالت‌های تکراری شماره‌های پشت‌سرِهم می‌گیرند
 * (پیش‌فرض تا مصاحبه، PHASES.md). Lot با همان کلیدِ ایمپورت پیدا یا ساخته می‌شود:
 * کالا + انبار + بچ + شید + کالیبر، بدون حساسیت به حروف و فاصله، زیرِ `track_shade_caliber`.
 */
export async function goodsIn(p: {
  tenantId: string; actorUserId: string; warehouseId: string; pallets: GoodsInPallet[];
}): Promise<GoodsInResult> {
  const { tenantId } = p;
  return withTenant(tenantId, async (tx) => {
    // همان قفلِ ایمپورت: هر دو lot می‌سازند و دو ورودِ هم‌زمان نباید دو lot با یک کلید بسازند
    await tx`SELECT pg_advisory_xact_lock(hashtext(${"import:" + tenantId}))`;
    const [wh] = await tx`SELECT 1 FROM warehouse WHERE tenant_id = ${tenantId} AND id = ${p.warehouseId}`;
    if (!wh) return { ok: false, reason: "warehouse_not_found" };
    const [{ mode }] = await tx<{ mode: "off" | "optional" | "required" }[]>`
      SELECT track_shade_caliber AS mode FROM tenant WHERE id = ${tenantId}`;

    const lines = p.pallets.flatMap((pl) => pl.lines);
    for (const l of lines) {
      if (mode === "off") { l.shadeCode = null; l.caliberCode = null; }
      if (mode === "required" && (!nk(l.shadeCode) || !nk(l.caliberCode))) return { ok: false, reason: "missing_shade_caliber" };
    }
    for (const pl of p.pallets) {
      const keys = pl.lines.map((l) => JSON.stringify([l.variantId, nk(l.batchNumber), nk(l.shadeCode), nk(l.caliberCode)]));
      if (new Set(keys).size !== keys.length) return { ok: false, reason: "duplicate_line" };
    }
    const variantIds = [...new Set(lines.map((l) => l.variantId))];
    const known = await tx<{ id: string }[]>`SELECT id FROM product_variant WHERE tenant_id = ${tenantId} AND id = ANY(${variantIds}::uuid[])`;
    if (known.length !== variantIds.length) return { ok: false, reason: "unknown_variant" };

    const existing = await tx<{ id: string; variant_id: string; batch_number: string | null; shade_code: string | null; caliber_code: string | null }[]>`
      SELECT id, variant_id, batch_number, shade_code, caliber_code FROM inventory_lot
      WHERE tenant_id = ${tenantId} AND warehouse_id = ${p.warehouseId} AND variant_id = ANY(${variantIds}::uuid[])`;
    const lotKey = (v: string, b: string | null, s: string | null, c: string | null) =>
      JSON.stringify([v, nk(b), mode === "off" ? null : nk(s), mode === "off" ? null : nk(c)]);
    const lotOf = new Map<string, string>();
    const lotFor = new Map<GoodsInLine, string>();
    for (const l of lines) {
      const k = lotKey(l.variantId, l.batchNumber ?? null, l.shadeCode ?? null, l.caliberCode ?? null);
      if (!lotOf.has(k)) {
        const m = existing.filter((e) => lotKey(e.variant_id, e.batch_number, e.shade_code, e.caliber_code) === k);
        if (m.length > 1) return { ok: false, reason: "ambiguous_lot", detail: `${m.length} lot با همین کالا، انبار، بچ، شید و کالیبر` };
        let id = m[0]?.id;
        if (!id) {
          [{ id }] = await tx<{ id: string }[]>`
            INSERT INTO inventory_lot (tenant_id, variant_id, warehouse_id, batch_number, shade_code, caliber_code)
            VALUES (${tenantId}, ${l.variantId}, ${p.warehouseId}, ${l.batchNumber?.trim() || null},
                    ${l.shadeCode?.trim() || null}, ${l.caliberCode?.trim() || null})
            RETURNING id`;
          await tx`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES (${tenantId}, ${id}, 0)`;
        }
        lotOf.set(k, id);
      }
      lotFor.set(l, lotOf.get(k)!);
    }

    const total = new Map<string, number>();
    for (const pl of p.pallets) for (const l of pl.lines) total.set(lotFor.get(l)!, (total.get(lotFor.get(l)!) ?? 0) + l.qty * pl.repeat);
    await lockBalances(tx, tenantId, [...total.keys()]);

    const receiptId = randomUUID();
    const ids = [...total.keys()], qs = ids.map((id) => total.get(id)!);
    await tx`
      UPDATE inventory_balance b SET on_hand_qty_boxes = b.on_hand_qty_boxes + v.q
      FROM unnest(${ids}::uuid[], ${qs}::int[]) AS v(id, q) WHERE b.lot_id = v.id AND b.tenant_id = ${tenantId}`;
    await tx`
      INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, reference_type, reference_id, actor_user_id)
      SELECT ${tenantId}::uuid, l, 'goods_in', q, 'goods_in', ${receiptId}::uuid, ${p.actorUserId}::uuid
      FROM unnest(${ids}::uuid[], ${qs}::int[]) AS v(l, q)`;

    const pallets: { id: string; col: string | null; pos: number | null; note: string | null }[] = [];
    const items: { pallet: string; lot: string; qty: number }[] = [];
    for (const pl of p.pallets) {
      for (let i = 0; i < pl.repeat; i++) {
        const id = randomUUID();
        pallets.push({ id, col: pl.columnCode?.trim() || null, pos: pl.positionNo ? pl.positionNo + i : null, note: pl.note?.trim() || null });
        for (const l of pl.lines) items.push({ pallet: id, lot: lotFor.get(l)!, qty: l.qty });
      }
    }
    const made = await tx<{ id: string; pallet_no: number }[]>`
      INSERT INTO pallet (id, tenant_id, warehouse_id, column_code, position_no, note, created_by)
      SELECT id, ${tenantId}::uuid, ${p.warehouseId}::uuid, c, n, t, ${p.actorUserId}::uuid
      FROM unnest(${pallets.map((x) => x.id)}::uuid[], ${pallets.map((x) => x.col)}::text[],
                  ${pallets.map((x) => x.pos)}::int[], ${pallets.map((x) => x.note)}::text[]) WITH ORDINALITY AS v(id, c, n, t, o)
      ORDER BY o
      RETURNING id, pallet_no::int AS pallet_no`;
    await tx`
      INSERT INTO pallet_item (tenant_id, pallet_id, lot_id, warehouse_id, qty_boxes)
      SELECT ${tenantId}::uuid, pid, lid, ${p.warehouseId}::uuid, q
      FROM unnest(${items.map((x) => x.pallet)}::uuid[], ${items.map((x) => x.lot)}::uuid[], ${items.map((x) => x.qty)}::int[]) AS v(pid, lid, q)`;

    const notified = await enqueueRestockNotifications(tx, tenantId, ids);
    const no = new Map(made.map((m) => [m.id, m.pallet_no]));
    return { ok: true, receiptId, palletNos: pallets.map((x) => no.get(x.id)!), notified };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// فهرست پالت‌ها و جمع موجودی
// ─────────────────────────────────────────────────────────────────────────────

export type PalletLine = {
  lotId: string; variantId: string; productName: string; productCode: string; sku: string; grade: string | null;
  batchNumber: string | null; shadeCode: string | null; caliberCode: string | null; qty: number; sqcmPerBox: number | null;
};
export type PalletRow = {
  id: string; palletNo: number; warehouseId: string; warehouseName: string; columnCode: string | null; positionNo: number | null;
  note: string | null; createdAt: Date; status: "in_stock" | "exited"; totalBoxes: number; lines: PalletLine[];
};

export async function listPallets(p: {
  tenantId: string; warehouseId?: string | null; q?: string | null; status?: "in_stock" | "exited" | "all"; limit?: number;
}): Promise<{ pallets: PalletRow[]; truncated: boolean }> {
  const { tenantId } = p;
  const status = p.status ?? "in_stock";
  const limit = Math.min(p.limit ?? 500, 10_000); // ۱۰٬۰۰۰ فقط برای نقشه؛ فهرستِ /api/pallets سقفش را نمی‌فرستد
  const q = p.q?.trim() ? `%${p.q.trim()}%` : null;
  return withTenant(tenantId, async (tx) => {
    const rows = await tx<(Omit<PalletRow, "status" | "totalBoxes"> & { lines: PalletLine[] | null })[]>`
      SELECT p.id, p.pallet_no::int AS "palletNo", p.warehouse_id AS "warehouseId", w.name AS "warehouseName",
             p.column_code AS "columnCode", p.position_no AS "positionNo", p.note, p.created_at AS "createdAt",
             (SELECT json_agg(json_build_object(
                'lotId', l.id, 'variantId', pv.id, 'productName', pr.name, 'productCode', pr.code, 'sku', pv.sku,
                'grade', pv.grade, 'batchNumber', l.batch_number, 'shadeCode', l.shade_code, 'caliberCode', l.caliber_code,
                'qty', pi.qty_boxes, 'sqcmPerBox', pv.sqcm_per_box) ORDER BY pr.name, pv.grade, l.id)
              FROM pallet_item pi JOIN inventory_lot l ON l.id = pi.lot_id
              JOIN product_variant pv ON pv.id = l.variant_id JOIN product pr ON pr.id = pv.product_id
              WHERE pi.pallet_id = p.id) AS lines
      FROM pallet p JOIN warehouse w ON w.id = p.warehouse_id
      WHERE p.tenant_id = ${tenantId}
        ${p.warehouseId ? tx`AND p.warehouse_id = ${p.warehouseId}` : tx``}
        ${status === "in_stock" ? tx`AND EXISTS (SELECT 1 FROM pallet_item x WHERE x.pallet_id = p.id)`
          : status === "exited" ? tx`AND NOT EXISTS (SELECT 1 FROM pallet_item x WHERE x.pallet_id = p.id)` : tx``}
        ${q ? tx`AND (p.pallet_no::text = ${p.q!.trim()} OR p.column_code ILIKE ${q} OR EXISTS (
              SELECT 1 FROM pallet_item x JOIN inventory_lot l ON l.id = x.lot_id
              JOIN product_variant pv ON pv.id = l.variant_id JOIN product pr ON pr.id = pv.product_id
              WHERE x.pallet_id = p.id AND (pr.name ILIKE ${q} OR pr.code ILIKE ${q} OR pv.sku ILIKE ${q} OR l.batch_number ILIKE ${q})))` : tx``}
      ORDER BY w.name, p.column_code NULLS FIRST, p.position_no NULLS FIRST, p.pallet_no
      LIMIT ${limit + 1}`;
    const pallets = rows.slice(0, limit).map((r): PalletRow => {
      const lines = r.lines ?? [];
      return { ...r, lines, status: lines.length ? "in_stock" : "exited", totalBoxes: lines.reduce((s, l) => s + l.qty, 0) };
    });
    return { pallets, truncated: rows.length > limit };
  });
}

export type StockRow = {
  variantId: string; productName: string; productCode: string; sku: string; grade: string | null;
  warehouseId: string; warehouseName: string; sqcmPerBox: number | null; boxesPerPallet: number | null;
  onHand: number; held: number; allocated: number; blocked: number; available: number; lots: number; pallets: number; unplacedBoxes: number;
};

/** جمعِ موجودی هر کالا در هر انبار. held از همان view محاسبه‌ای است، نه ستونِ ذخیره‌شده (قانون ۱). */
export async function stockSummary(p: { tenantId: string; warehouseId?: string | null; q?: string | null }): Promise<StockRow[]> {
  const q = p.q?.trim() ? `%${p.q.trim()}%` : null;
  return withTenant(p.tenantId, (tx) => tx<StockRow[]>`
    SELECT pv.id AS "variantId", pr.name AS "productName", pr.code AS "productCode", pv.sku, pv.grade,
           w.id AS "warehouseId", w.name AS "warehouseName", pv.sqcm_per_box AS "sqcmPerBox", pv.boxes_per_pallet AS "boxesPerPallet",
           SUM(a.on_hand_qty_boxes)::int AS "onHand", SUM(a.held_qty_boxes)::int AS held,
           SUM(a.allocated_qty_boxes)::int AS allocated, SUM(a.blocked_qty_boxes)::int AS blocked,
           SUM(a.available_qty_boxes)::int AS available, COUNT(*) FILTER (WHERE a.on_hand_qty_boxes > 0)::int AS lots,
           (SELECT COUNT(DISTINCT pi.pallet_id) FROM pallet_item pi JOIN inventory_lot l2 ON l2.id = pi.lot_id
             WHERE l2.variant_id = pv.id AND l2.warehouse_id = w.id)::int AS pallets,
           (SELECT COALESCE(SUM(pi.qty_boxes), 0) FROM pallet_item pi JOIN pallet pa ON pa.id = pi.pallet_id
             JOIN inventory_lot l2 ON l2.id = pi.lot_id
             WHERE l2.variant_id = pv.id AND l2.warehouse_id = w.id AND pa.column_code IS NULL)::int AS "unplacedBoxes"
    FROM v_lot_availability a
    JOIN inventory_lot l ON l.id = a.lot_id
    JOIN product_variant pv ON pv.id = l.variant_id JOIN product pr ON pr.id = pv.product_id
    JOIN warehouse w ON w.id = l.warehouse_id
    WHERE a.tenant_id = ${p.tenantId}
      ${p.warehouseId ? tx`AND l.warehouse_id = ${p.warehouseId}` : tx``}
      ${q ? tx`AND (pr.name ILIKE ${q} OR pr.code ILIKE ${q} OR pv.sku ILIKE ${q})` : tx``}
    GROUP BY pv.id, pr.name, pr.code, w.id, w.name
    HAVING SUM(a.on_hand_qty_boxes) > 0
    ORDER BY pr.name, pv.grade NULLS FIRST, w.name`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ویرایش، انتقال و خروج پالت
// ─────────────────────────────────────────────────────────────────────────────

export const EXIT_REASONS = ["waste", "breakage", "sample", "internal_use", "other"] as const;
export type ExitReason = (typeof EXIT_REASONS)[number];
export const ADJUST_REASONS = ["count_correction", "damage", "other"] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];

export type PalletOpResult =
  | { ok: true; newPalletNo?: number }
  | { ok: false; reason: "not_found" | "unknown_line" | "duplicate_line" | "exceeds_pallet" | "below_committed" | "reason_required" | "empty_pallet" | "stale" | "no_quantity"; detail?: string };

type Item = { id: string; lot_id: string; qty_boxes: number };
type Loaded = { pallet: { id: string; pallet_no: number; warehouse_id: string; column_code: string | null; position_no: number | null; note: string | null }; items: Item[]; bal: Map<string, LockedBalance> };

/**
 * قفل به ترتیبِ قانون ۴: اول balanceِ همه‌ی lotهای روی پالت (به ترتیبِ lot_id)، بعد خودِ پالت.
 * ردیف‌های پالت را فقط کسی عوض می‌کند که balanceِ آن lot را قفل کرده، پس بعد از قفل پایدارند.
 */
async function loadPallet(tx: TransactionSql, tenantId: string, palletId: string): Promise<Loaded | null> {
  const before = await tx<{ lot_id: string }[]>`SELECT lot_id FROM pallet_item WHERE tenant_id = ${tenantId} AND pallet_id = ${palletId}`;
  const bal = await lockBalances(tx, tenantId, before.map((x) => x.lot_id));
  const [pallet] = await tx<Loaded["pallet"][]>`
    SELECT id, pallet_no::int AS pallet_no, warehouse_id, column_code, position_no, note FROM pallet
    WHERE tenant_id = ${tenantId} AND id = ${palletId} FOR UPDATE`;
  if (!pallet) return null;
  const items = await tx<Item[]>`SELECT id, lot_id, qty_boxes FROM pallet_item WHERE tenant_id = ${tenantId} AND pallet_id = ${palletId} ORDER BY lot_id`;
  return { pallet, items, bal };
}

const loc = (c: string | null, n: number | null) => ({ columnCode: c, positionNo: n });

/**
 * ویرایشِ پالت: محل، یادداشت و تعدادِ هر ردیف. تغییرِ تعداد یعنی اصلاحِ موجودی (on_hand) با دلیل و
 * ثبت در لجر (`pallet_adjust`)؛ کم کردن هرگز on_hand را زیرِ تعهد (allocated + blocked + held) نمی‌برد.
 * تعدادِ صفر آن ردیف را از پالت برمی‌دارد.
 */
export async function editPallet(p: {
  tenantId: string; actorUserId: string; palletId: string; columnCode: string | null; positionNo: number | null;
  note?: string | null; lines: EditLine[]; reason?: AdjustReason | null; reasonNote?: string | null;
}): Promise<PalletOpResult> {
  const { tenantId } = p;
  if (hasDupLots(p.lines)) return { ok: false, reason: "duplicate_line" };
  return withTenant(tenantId, async (tx) => {
    const x = await loadPallet(tx, tenantId, p.palletId);
    if (!x) return { ok: false, reason: "not_found" };
    const cur = new Map(x.items.map((i) => [i.lot_id, i]));
    for (const l of p.lines) if (!cur.has(l.lotId)) return { ok: false, reason: "unknown_line" };
    // بین باز شدن فرم و ثبت، خروج یا بارگیری این ردیف را عوض کرده: ثبتِ عددِ مطلقِ کهنه آن را برمی‌گرداند
    for (const l of p.lines) if (cur.get(l.lotId)!.qty_boxes !== l.expected)
      return { ok: false, reason: "stale", detail: `${l.lotId}: ${cur.get(l.lotId)!.qty_boxes} ≠ ${l.expected}` };
    const changes = p.lines.filter((l) => l.qty !== cur.get(l.lotId)!.qty_boxes);
    if (changes.length && !p.reason) return { ok: false, reason: "reason_required" };
    if (changes.length && p.reason === "other" && !p.reasonNote?.trim()) return { ok: false, reason: "reason_required" };
    for (const l of changes) {
      const d = l.qty - cur.get(l.lotId)!.qty_boxes, b = x.bal.get(l.lotId)!;
      if (d < 0 && b.on_hand + d < b.committed)
        return { ok: false, reason: "below_committed", detail: `${b.on_hand + d} < ${b.committed}` };
    }
    for (const l of changes) {
      const it = cur.get(l.lotId)!, d = l.qty - it.qty_boxes;
      if (l.qty === 0) await tx`DELETE FROM pallet_item WHERE id = ${it.id}`;
      else await tx`UPDATE pallet_item SET qty_boxes = ${l.qty} WHERE id = ${it.id}`;
      await tx`UPDATE inventory_balance SET on_hand_qty_boxes = on_hand_qty_boxes + ${d} WHERE tenant_id = ${tenantId} AND lot_id = ${l.lotId}`;
      await tx`
        INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, reference_type, reference_id, actor_user_id, reason_code, note)
        VALUES (${tenantId}, ${l.lotId}, 'pallet_adjust', ${d}, 'pallet', ${p.palletId}, ${p.actorUserId}, ${p.reason!}, ${p.reasonNote?.trim() || null})`;
    }
    const col = p.columnCode?.trim() || null, note = p.note === undefined ? x.pallet.note : p.note?.trim() || null;
    await tx`UPDATE pallet SET column_code = ${col}, position_no = ${p.positionNo}, note = ${note} WHERE id = ${p.palletId}`;
    await writeAudit(tx, {
      tenantId, actorUserId: p.actorUserId, action: "pallet.edit", entity: "pallet", entityId: p.palletId,
      oldValue: { ...loc(x.pallet.column_code, x.pallet.position_no), note: x.pallet.note, lines: x.items.map((i) => ({ lotId: i.lot_id, qty: i.qty_boxes })) },
      newValue: { ...loc(col, p.positionNo), note, lines: p.lines.map((l) => ({ lotId: l.lotId, qty: l.qty })), reason: p.reason ?? null },
    });
    if (changes.some((l) => l.qty > cur.get(l.lotId)!.qty_boxes))
      await enqueueRestockNotifications(tx, tenantId, changes.map((l) => l.lotId));
    return { ok: true };
  });
}

/**
 * انتقالِ پالت در همان انبار. بدونِ `lines` کلِ پالت جابه‌جا می‌شود؛ با `lines` همان کارتن‌ها روی
 * پالتِ تازه در محلِ مقصد می‌روند (تقسیمِ پالت). on_hand عوض نمی‌شود ولی قفل همان قفلِ موجودی است.
 */
export async function transferPallet(p: {
  tenantId: string; actorUserId: string; palletId: string; columnCode: string | null; positionNo: number | null; lines?: LotQty[] | null;
}): Promise<PalletOpResult> {
  const { tenantId } = p;
  return withTenant(tenantId, async (tx) => {
    const x = await loadPallet(tx, tenantId, p.palletId);
    if (!x) return { ok: false, reason: "not_found" };
    if (x.items.length === 0) return { ok: false, reason: "empty_pallet" };
    const col = p.columnCode?.trim() || null;
    const cur = new Map(x.items.map((i) => [i.lot_id, i]));
    if (p.lines && hasDupLots(p.lines)) return { ok: false, reason: "duplicate_line" };
    const lines = (p.lines ?? []).filter((l) => l.qty > 0);
    // ردیف‌ها آمده ولی همه صفر: یعنی «هیچ»، نه «کلِ پالت»
    if (p.lines && p.lines.length > 0 && lines.length === 0) return { ok: false, reason: "no_quantity" };
    for (const l of lines) {
      const it = cur.get(l.lotId);
      if (!it) return { ok: false, reason: "unknown_line" };
      if (l.qty > it.qty_boxes) return { ok: false, reason: "exceeds_pallet" };
    }
    const whole = lines.length === 0 || x.items.every((i) => lines.find((l) => l.lotId === i.lot_id)?.qty === i.qty_boxes);
    let newPalletNo: number | undefined;
    if (whole) {
      await tx`UPDATE pallet SET column_code = ${col}, position_no = ${p.positionNo} WHERE id = ${p.palletId}`;
    } else {
      const [np] = await tx<{ id: string; pallet_no: number }[]>`
        INSERT INTO pallet (tenant_id, warehouse_id, column_code, position_no, note, created_by)
        VALUES (${tenantId}, ${x.pallet.warehouse_id}, ${col}, ${p.positionNo}, ${`تقسیم از پالت ${x.pallet.pallet_no}`}, ${p.actorUserId})
        RETURNING id, pallet_no::int AS pallet_no`;
      newPalletNo = np.pallet_no;
      await applyCuts(tx, lines.map((l) => ({ id: cur.get(l.lotId)!.id, qty_boxes: cur.get(l.lotId)!.qty_boxes, rm: l.qty })));
      await tx`
        INSERT INTO pallet_item (tenant_id, pallet_id, lot_id, warehouse_id, qty_boxes)
        SELECT ${tenantId}::uuid, ${np.id}::uuid, lid, ${x.pallet.warehouse_id}::uuid, q
        FROM unnest(${lines.map((l) => l.lotId)}::uuid[], ${lines.map((l) => l.qty)}::int[]) AS v(lid, q)`;
    }
    await writeAudit(tx, {
      tenantId, actorUserId: p.actorUserId, action: "pallet.transfer", entity: "pallet", entityId: p.palletId,
      oldValue: loc(x.pallet.column_code, x.pallet.position_no),
      newValue: { ...loc(col, p.positionNo), lines: whole ? null : lines.map((l) => ({ lotId: l.lotId, qty: l.qty })), newPalletNo: newPalletNo ?? null },
    });
    return { ok: true, newPalletNo };
  });
}

/**
 * خروجِ غیرفروش (ضایعات، شکستگی، نمونه، مصرفِ داخلی) از یک پالت. on_hand کم می‌شود و در لجر
 * `stock_exit` با دلیل ثبت می‌شود. مثلِ رزرو (قانون ۲): کالای رزرو، تخصیص یا بلوکه‌شده خارج نمی‌شود.
 */
export async function exitStock(p: {
  tenantId: string; actorUserId: string; palletId: string; lines: LotQty[]; reason: ExitReason; note?: string | null;
}): Promise<PalletOpResult> {
  const { tenantId } = p;
  if (p.reason === "other" && !p.note?.trim()) return { ok: false, reason: "reason_required" };
  // تکرارِ یک lot موجودی را یک بار ولی لجر را دو بار کم می‌کرد (یافته‌ی بازبین)
  if (hasDupLots(p.lines)) return { ok: false, reason: "duplicate_line" };
  return withTenant(tenantId, async (tx) => {
    const x = await loadPallet(tx, tenantId, p.palletId);
    if (!x) return { ok: false, reason: "not_found" };
    const cur = new Map(x.items.map((i) => [i.lot_id, i]));
    const lines = p.lines.filter((l) => l.qty > 0);
    if (lines.length === 0) return { ok: false, reason: "unknown_line" };
    for (const l of lines) {
      const it = cur.get(l.lotId);
      if (!it) return { ok: false, reason: "unknown_line" };
      if (l.qty > it.qty_boxes) return { ok: false, reason: "exceeds_pallet" };
      const b = x.bal.get(l.lotId)!;
      if (b.on_hand - l.qty < b.committed)
        return { ok: false, reason: "below_committed", detail: `${b.on_hand - l.qty} < ${b.committed}` };
    }
    await applyCuts(tx, lines.map((l) => ({ id: cur.get(l.lotId)!.id, qty_boxes: cur.get(l.lotId)!.qty_boxes, rm: l.qty })));
    await tx`
      UPDATE inventory_balance b SET on_hand_qty_boxes = b.on_hand_qty_boxes - v.q
      FROM unnest(${lines.map((l) => l.lotId)}::uuid[], ${lines.map((l) => l.qty)}::int[]) AS v(id, q)
      WHERE b.lot_id = v.id AND b.tenant_id = ${tenantId}`;
    await tx`
      INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, reference_type, reference_id, actor_user_id, reason_code, note)
      SELECT ${tenantId}::uuid, l, 'stock_exit', -q, 'pallet', ${p.palletId}::uuid, ${p.actorUserId}::uuid, ${p.reason}, ${p.note?.trim() || null}
      FROM unnest(${lines.map((l) => l.lotId)}::uuid[], ${lines.map((l) => l.qty)}::int[]) AS v(l, q)`;
    return { ok: true };
  });
}

export type ExitRow = {
  id: string; occurredAt: Date; palletNo: number | null; productName: string; productCode: string; grade: string | null;
  batchNumber: string | null; qty: number; reason: string | null; note: string | null; actorName: string | null; warehouseName: string;
};

export async function listExits(p: { tenantId: string; limit?: number }): Promise<ExitRow[]> {
  return withTenant(p.tenantId, (tx) => tx<ExitRow[]>`
    SELECT t.id, t.occurred_at AS "occurredAt", pa.pallet_no::int AS "palletNo", pr.name AS "productName", pr.code AS "productCode",
           pv.grade, l.batch_number AS "batchNumber", -t.on_hand_delta_boxes AS qty, t.reason_code AS reason, t.note,
           u.full_name AS "actorName", w.name AS "warehouseName"
    FROM inventory_transaction t
    JOIN inventory_lot l ON l.id = t.lot_id
    JOIN product_variant pv ON pv.id = l.variant_id JOIN product pr ON pr.id = pv.product_id
    JOIN warehouse w ON w.id = l.warehouse_id
    LEFT JOIN pallet pa ON pa.id = t.reference_id AND t.reference_type = 'pallet'
    LEFT JOIN app_user u ON u.id = t.actor_user_id
    WHERE t.tenant_id = ${p.tenantId} AND t.transaction_type = 'stock_exit'
    ORDER BY t.occurred_at DESC, t.id
    LIMIT ${Math.min(p.limit ?? 200, 1000)}`);
}
