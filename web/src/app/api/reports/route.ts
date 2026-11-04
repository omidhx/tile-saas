import { NextResponse } from "next/server";
import { staffPageCtx } from "@/auth/httpCtx";
import { buildReports, buildMonthlyAgentPerf } from "@/db/reports";

const DAY = 24 * 60 * 60 * 1000;

/**
 * GET /api/reports?tenantId&from&to[&agentAccountId][&variantId] — گزارش‌های مدیریتی (staff-only، فقط خواندنی).
 * GET /api/reports?tenantId&monthly=1[&months] — همان دسترسی، عملکردِ نماینده ماه‌به‌ماه (بازه‌ی مقایسه‌ای، نه from/to).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await staffPageCtx(u.searchParams.get("tenantId"), "reports");
  if ("err" in c) return c.err;

  if (u.searchParams.get("monthly") === "1") {
    const months = Number(u.searchParams.get("months")) || 6;
    return NextResponse.json(await buildMonthlyAgentPerf({ tenantId: c.tenantId, months }));
  }

  // پیش‌فرض: ۳۰ روز گذشته. تاریخِ نامعتبر → پیش‌فرض، نه NaN که کوئری را بی‌سروصدا خالی کند.
  const parse = (s: string | null, fallback: Date) => {
    const d = s ? new Date(s) : null;
    return d && !Number.isNaN(d.getTime()) ? d : fallback;
  };
  const to = parse(u.searchParams.get("to"), new Date());
  const from = parse(u.searchParams.get("from"), new Date(to.getTime() - 30 * DAY));
  if (from >= to) return NextResponse.json({ error: "bad_range" }, { status: 400 });

  const agentAccountId = u.searchParams.get("agentAccountId") || null;
  const variantId = u.searchParams.get("variantId") || null;

  return NextResponse.json(await buildReports({ tenantId: c.tenantId, from, to, agentAccountId, variantId }));
}
