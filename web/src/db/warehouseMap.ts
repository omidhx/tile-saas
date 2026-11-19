import { withTenant } from "./client";
import { writeAudit } from "./audit";
import { listPallets, type PalletRow } from "./pallets";
import { slotKey } from "@/lib/slotKey";

/**
 * نقشه‌ی انبار (فاز ۸). مدیر چیدمان را یک بار روی شبکه می‌کشد: هر خانه یا «جای پالت» (ستون + شماره) است
 * یا راهرو. پالت به خانه FK ندارد و با همان `column_code` + `position_no` خودش روی خانه نشان داده می‌شود،
 * پس ذخیره‌ی چیدمان هیچ پالتی و هیچ عدد موجودی‌ای را عوض نمی‌کند. جابه‌جایی پالت روی نقشه از همان
 * `transferPallet` می‌رود (قفل balance، بعد پالت، بعد ردیف پالت)، نه از این فایل.
 */

export type Cell = { x: number; y: number; kind: "slot" | "aisle"; columnCode: string | null; positionNo: number | null };
/** free: هیچ Lot روی پالت تعهد ندارد. partial: بخشی از یک Lot رزرو/تخصیص/بلوکه است. reserved: هیچ کارتن آزادی در Lotهای پالت نیست. */
export type MapStatus = "free" | "partial" | "reserved";
export type MapPallet = PalletRow & { mapStatus: MapStatus };

export const GRID_MAX = 60;
/** همان columnKeyِ lib/slotKey.ts، در SQL (و همان عبارتِ ایندکسِ uq_warehouse_cell_slot). */
const colKey = (c: string) => `upper(translate(btrim(${c}), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩يك', '01234567890123456789یک'))`;

export async function getWarehouseMap(p: { tenantId: string; warehouseId: string }) {
  const { tenantId, warehouseId } = p;
  const base = await withTenant(tenantId, async (tx) => {
    const [wh] = await tx`SELECT 1 FROM warehouse WHERE tenant_id = ${tenantId} AND id = ${warehouseId}`;
    if (!wh) return null;
    const cells = await tx<Cell[]>`
      SELECT x, y, kind, column_code AS "columnCode", position_no AS "positionNo"
      FROM warehouse_cell WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId} ORDER BY y, x`;
    // held از view محاسبه‌ای (قانون ۱)؛ فقط برای رنگ، پس قفل لازم نیست
    const avail = await tx<{ lot_id: string; on_hand: number; available: number }[]>`
      SELECT a.lot_id, a.on_hand_qty_boxes AS on_hand, a.available_qty_boxes AS available
      FROM v_lot_availability a JOIN inventory_lot l ON l.id = a.lot_id
      WHERE a.tenant_id = ${tenantId} AND l.warehouse_id = ${warehouseId} AND a.on_hand_qty_boxes > 0`;
    return { cells, avail: new Map(avail.map((a) => [a.lot_id, a])) };
  });
  if (!base) return null;
  const { pallets, truncated } = await listPallets({ tenantId, warehouseId, status: "in_stock", limit: 10_000 });
  const withStatus = pallets.map((pl): MapPallet => {
    const lots = pl.lines.map((l) => base.avail.get(l.lotId));
    const mapStatus: MapStatus = lots.every((a) => a && a.available <= 0) ? "reserved"
      : lots.some((a) => a && a.available < a.on_hand) ? "partial" : "free";
    return { ...pl, mapStatus };
  });
  return { cells: base.cells, pallets: withStatus, truncated };
}

export type SaveLayoutResult =
  | { ok: true; cells: number; offMap: number }
  | { ok: false; reason: "warehouse_not_found" | "duplicate_cell" | "duplicate_slot" | "invalid_cell"; detail?: string };

/**
 * چیدمان را کامل جایگزین می‌کند (همه‌ی خانه‌های این انبار). `offMap` تعداد پالت‌های در انباری است که
 * با چیدمان تازه جایی روی نقشه ندارند؛ پالت‌ها عوض نمی‌شوند، فقط در «بیرون از نقشه» دیده می‌شوند.
 */
export async function saveLayout(p: { tenantId: string; actorUserId: string; warehouseId: string; cells: Cell[] }): Promise<SaveLayoutResult> {
  const { tenantId, warehouseId } = p;
  const cells = p.cells.map((c) => c.kind === "slot"
    ? { ...c, columnCode: c.columnCode?.trim() || null }
    : { ...c, columnCode: null, positionNo: null });
  for (const c of cells) {
    if (c.x < 0 || c.y < 0 || c.x >= GRID_MAX || c.y >= GRID_MAX || (c.kind === "slot" && (!c.columnCode || !c.positionNo || c.positionNo < 1)))
      return { ok: false, reason: "invalid_cell", detail: `${c.x},${c.y}` };
  }
  const xy = cells.map((c) => `${c.x},${c.y}`);
  if (new Set(xy).size !== xy.length) return { ok: false, reason: "duplicate_cell" };
  const slots = cells.filter((c) => c.kind === "slot").map((c) => slotKey(c.columnCode!, c.positionNo!));
  const dup = slots.find((k, i) => slots.indexOf(k) !== i);
  if (dup) return { ok: false, reason: "duplicate_slot", detail: dup.replace("#", " ") };

  return withTenant(tenantId, async (tx) => {
    // دو ذخیره‌ی هم‌زمان روی یک انبار پشت هم می‌روند، نه اینکه DELETE یکی وسط INSERT دیگری بیفتد.
    // NO KEY: قفلِ FOR KEY SHAREِ چکِ FK (ورود کالا، تقسیم پالت، ایمپورت در همین انبار) را نمی‌بندد.
    const [wh] = await tx`SELECT 1 FROM warehouse WHERE tenant_id = ${tenantId} AND id = ${warehouseId} FOR NO KEY UPDATE`;
    if (!wh) return { ok: false, reason: "warehouse_not_found" };
    const [{ before }] = await tx<{ before: number }[]>`
      SELECT count(*)::int AS before FROM warehouse_cell WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}`;
    await tx`DELETE FROM warehouse_cell WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}`;
    if (cells.length) await tx`
      INSERT INTO warehouse_cell (tenant_id, warehouse_id, x, y, kind, column_code, position_no)
      SELECT ${tenantId}::uuid, ${warehouseId}::uuid, x, y, k, c, n
      FROM unnest(${cells.map((c) => c.x)}::int[], ${cells.map((c) => c.y)}::int[], ${cells.map((c) => c.kind)}::text[],
                  ${cells.map((c) => c.columnCode)}::text[], ${cells.map((c) => c.positionNo)}::int[]) AS v(x, y, k, c, n)`;
    const [{ offMap }] = await tx<{ offMap: number }[]>`
      SELECT count(*)::int AS "offMap" FROM pallet p
      WHERE p.tenant_id = ${tenantId} AND p.warehouse_id = ${warehouseId}
        AND EXISTS (SELECT 1 FROM pallet_item x WHERE x.pallet_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM warehouse_cell c WHERE c.tenant_id = p.tenant_id AND c.warehouse_id = p.warehouse_id
          AND c.kind = 'slot' AND ${tx.unsafe(colKey("c.column_code"))} = ${tx.unsafe(colKey("p.column_code"))} AND c.position_no = p.position_no)`;
    await writeAudit(tx, {
      tenantId, actorUserId: p.actorUserId, action: "warehouse.layout", entity: "warehouse", entityId: warehouseId,
      oldValue: { cells: before },
      newValue: { cells: cells.length, slots: slots.length, aisles: cells.length - slots.length, offMap },
    });
    return { ok: true, cells: cells.length, offMap };
  });
}
