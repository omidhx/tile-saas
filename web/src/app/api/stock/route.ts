import { NextResponse } from "next/server";
import { isId } from "@/lib/validate";
import { staffCtx } from "@/auth/httpCtx";
import { stockSummary } from "@/db/pallets";

/** GET /api/stock?tenantId&warehouseId&q — جمعِ موجودی هر کالا در هر انبار (on_hand، held، allocated، available، پالت). */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const c = await staffCtx(u.get("tenantId"));
  if ("err" in c) return c.err;
  const wh = u.get("warehouseId");
  if (wh && !isId(wh)) return NextResponse.json({ error: "invalid", fields: ["warehouseId"] }, { status: 400 });
  return NextResponse.json({ rows: await stockSummary({ tenantId: c.tenantId, warehouseId: wh, q: u.get("q") }) });
}
