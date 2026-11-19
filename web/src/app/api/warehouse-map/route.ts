import { NextResponse } from "next/server";
import { z } from "zod";
import { id, positive, parse, isId } from "@/lib/validate";
import { adminCtx, staffCtx } from "@/auth/httpCtx";
import { getWarehouseMap, saveLayout, GRID_MAX } from "@/db/warehouseMap";

const coord = z.number().int().min(0).max(GRID_MAX - 1);
const Put = z.object({
  warehouseId: id,
  cells: z.array(z.object({
    x: coord, y: coord, kind: z.enum(["slot", "aisle"]),
    columnCode: z.string().trim().min(1).max(40).nullish(), positionNo: positive.max(100_000).nullish(),
  })).max(GRID_MAX * GRID_MAX),
});

/** GET /api/warehouse-map?tenantId&warehouseId — خانه‌های چیدمان و پالت‌های در انبار با رنگ وضعیت (staff). */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const c = await staffCtx(u.get("tenantId"));
  if ("err" in c) return c.err;
  const wh = u.get("warehouseId");
  if (!isId(wh)) return NextResponse.json({ error: "invalid", fields: ["warehouseId"] }, { status: 400 });
  const r = await getWarehouseMap({ tenantId: c.tenantId, warehouseId: wh });
  if (!r) return NextResponse.json({ error: "warehouse_not_found" }, { status: 404 });
  return NextResponse.json(r);
}

/** PUT /api/warehouse-map — جایگزینی کامل چیدمان یک انبار؛ فقط مدیر. پالت‌ها عوض نمی‌شوند. */
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Put, body);
  if ("err" in p) return p.err;
  const r = await saveLayout({
    tenantId: c.tenantId, actorUserId: c.userId, warehouseId: p.data.warehouseId,
    cells: p.data.cells.map((x) => ({ ...x, columnCode: x.columnCode ?? null, positionNo: x.positionNo ?? null })),
  });
  if (!r.ok) return NextResponse.json({ error: r.reason, detail: r.detail }, { status: r.reason === "warehouse_not_found" ? 404 : 422 });
  return NextResponse.json(r);
}
