import { NextResponse } from "next/server";
import { staffCtx } from "@/auth/httpCtx";
import { getDashboardKpis } from "@/db/dashboard";

/** GET /api/dashboard?tenantId — KPIِ سریعِ صفحه‌ی اولِ پشتیبان. */
export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  return NextResponse.json(await getDashboardKpis(c.tenantId));
}
