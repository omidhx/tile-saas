import { NextResponse } from "next/server";
import { staffCtx } from "@/auth/httpCtx";
import { buildReports } from "@/db/reports";
import { isId } from "@/lib/validate";

const DAY = 24 * 60 * 60 * 1000;

/**
 * GET /api/reports?tenantId&from&to[&agentAccountId][&variantId] — گزارش‌های مدیریتی (staff-only، فقط خواندنی).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await staffCtx(u.searchParams.get("tenantId"));
  if ("err" in c) return c.err;

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
  if ((agentAccountId && !isId(agentAccountId)) || (variantId && !isId(variantId))) return NextResponse.json({ error: "invalid" }, { status: 400 });

  return NextResponse.json(await buildReports({ tenantId: c.tenantId, from, to, agentAccountId, variantId }));
}
