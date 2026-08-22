import { NextResponse } from "next/server";
import { staffCtx } from "@/auth/httpCtx";
import { listSalesRequests } from "@/db/salesRequests";

/** GET /api/sales-requests?tenantId&status=approved — برای پنل staff (حواله‌سازی). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const c = await staffCtx(url.searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const status = url.searchParams.get("status") ?? "approved";
  const requests = await listSalesRequests({ tenantId: c.tenantId, status });
  return NextResponse.json({ requests });
}
