import { NextResponse } from "next/server";
import { staffCtx } from "@/auth/httpCtx";
import { listBackorderItems } from "@/db/dispatches";

/** GET /api/backorders?tenantId[&q][&offset] — اقلامِ backorder برای پنل staff، صفحه‌بندی‌شده. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await staffCtx(u.searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const q = u.searchParams.get("q") ?? undefined;
  const offset = Number(u.searchParams.get("offset") ?? "0") || 0;
  const { items, hasMore } = await listBackorderItems({ tenantId: c.tenantId, q, offset });
  return NextResponse.json({ items, hasMore });
}
