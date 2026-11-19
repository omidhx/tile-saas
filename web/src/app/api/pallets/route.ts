import { NextResponse } from "next/server";
import { z } from "zod";
import { id, positive, count, parse, isId } from "@/lib/validate";
import { staffCtx } from "@/auth/httpCtx";
import {
  goodsIn, listPallets, listExits, editPallet, transferPallet, exitStock, EXIT_REASONS, ADJUST_REASONS,
} from "@/db/pallets";

const INT = 2_147_483_647;
const text = z.string().max(200).nullish();
const column = z.string().trim().max(40).nullish();
const position = positive.max(100_000).nullish();
// یک lot دو بار در یک درخواست: خروج لجر را دو بار می‌نوشت (یافته‌ی بازبین فاز ۷)
const uniqueLots = (ls: { lotId: string }[]) => new Set(ls.map((l) => l.lotId)).size === ls.length;
const lines = z.array(z.object({ lotId: id, qty: count.max(INT) })).max(20).refine(uniqueLots);
const editLines = z.array(z.object({ lotId: id, qty: count.max(INT), expected: count.max(INT) })).max(20).refine(uniqueLots);

const GoodsIn = z.object({
  warehouseId: id,
  pallets: z.array(z.object({
    columnCode: column, positionNo: position, note: text,
    repeat: positive.max(200),
    lines: z.array(z.object({
      variantId: id, batchNumber: text, shadeCode: text, caliberCode: text, qty: positive.max(100_000),
    })).min(1).max(10),
  })).min(1).max(100),
});

const Patch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), palletId: id, columnCode: column, positionNo: position, note: text, lines: editLines,
    reason: z.enum(ADJUST_REASONS).nullish(), reasonNote: text }),
  z.object({ action: z.literal("transfer"), palletId: id, columnCode: column, positionNo: position, lines: lines.nullish() }),
  z.object({ action: z.literal("exit"), palletId: id, lines: lines.min(1), reason: z.enum(EXIT_REASONS), note: text }),
]);

/** GET /api/pallets?tenantId&warehouseId&q&status=in_stock|exited|all — فهرست پالت‌ها؛ view=exits سابقه‌ی خروج. */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const c = await staffCtx(u.get("tenantId"));
  if ("err" in c) return c.err;
  if (u.get("view") === "exits") return NextResponse.json({ exits: await listExits({ tenantId: c.tenantId }) });
  const wh = u.get("warehouseId");
  if (wh && !isId(wh)) return NextResponse.json({ error: "invalid", fields: ["warehouseId"] }, { status: 400 });
  const s = u.get("status");
  const status = s === "exited" || s === "all" ? s : "in_stock";
  return NextResponse.json(await listPallets({ tenantId: c.tenantId, warehouseId: wh, q: u.get("q"), status }));
}

/** POST /api/pallets — ورود کالا: چند پالت، هر کدام یک یا چند ردیف و «تکرار ×n». */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(GoodsIn, body);
  if ("err" in p) return p.err;
  const total = p.data.pallets.reduce((s, x) => s + x.repeat, 0);
  if (total > 500) return NextResponse.json({ error: "too_many_pallets" }, { status: 400 });
  const r = await goodsIn({ tenantId: c.tenantId, actorUserId: c.userId, ...p.data });
  if (!r.ok) return NextResponse.json({ error: r.reason, detail: r.detail },
    { status: r.reason === "warehouse_not_found" || r.reason === "unknown_variant" ? 404 : 422 });
  return NextResponse.json(r, { status: 201 });
}

/** PATCH /api/pallets {action: edit|transfer|exit} — ویرایش، انتقال و خروج غیرفروش. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Patch, body);
  if ("err" in p) return p.err;
  const base = { tenantId: c.tenantId, actorUserId: c.userId };
  const d = p.data;
  const r = d.action === "edit"
    ? await editPallet({ ...base, palletId: d.palletId, columnCode: d.columnCode ?? null, positionNo: d.positionNo ?? null,
        note: d.note, lines: d.lines, reason: d.reason, reasonNote: d.reasonNote })
    : d.action === "transfer"
      ? await transferPallet({ ...base, palletId: d.palletId, columnCode: d.columnCode ?? null, positionNo: d.positionNo ?? null, lines: d.lines })
      : await exitStock({ ...base, palletId: d.palletId, lines: d.lines, reason: d.reason, note: d.note });
  if (!r.ok) return NextResponse.json({ error: r.reason, detail: r.detail },
    { status: r.reason === "not_found" ? 404 : r.reason === "below_committed" || r.reason === "stale" ? 409 : 422 });
  return NextResponse.json(r);
}
