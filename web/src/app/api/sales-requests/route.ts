import { NextResponse } from "next/server";
import { staffCtx } from "@/auth/httpCtx";
import { z } from "zod";
import { listSalesRequests } from "@/db/salesRequests";

/** GET /api/sales-requests?tenantId&status=approved — برای پنل staff (حواله‌سازی). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const c = await staffCtx(url.searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const st = z.enum(["draft", "submitted", "approved", "rejected", "cancelled", "fulfilled"])
    .safeParse(url.searchParams.get("status") ?? "approved");
  if (!st.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const status = st.data;
  const requests = await listSalesRequests({ tenantId: c.tenantId, status });
  return NextResponse.json({ requests });
}
