import { NextResponse } from "next/server";
import { staffCtx } from "@/auth/httpCtx";
import { createDispatchFromRequest, createBackorderDispatch, listDispatches } from "@/db/dispatches";

/** GET /api/sales-dispatches?tenantId[&q][&offset] — لیستِ حواله‌ها برای پنل staff، صفحه‌بندی‌شده. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await staffCtx(u.searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const q = u.searchParams.get("q") ?? undefined;
  const offset = Number(u.searchParams.get("offset") ?? "0") || 0;
  const { items: dispatches, hasMore } = await listDispatches({ tenantId: c.tenantId, q, offset });
  return NextResponse.json({ dispatches, hasMore });
}

/**
 * POST /api/sales-dispatches — ساخت حواله (staff-only، spec ۵.۶). دو حالت بر اساس body:
 *   • { salesRequestId }        → حواله از SalesRequestِ تأییدشده (اقلام in_stock)
 *   • { agentAccountId, items } → حواله‌ی مستقلِ backorder (محصول ناموجود، بیرون از موجودی)
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { salesRequestId, agentAccountId, items, customerName, destination, customerId } = body ?? {};
  // dispatchCode دیگر از کلاینت نمی‌آید — سرور خودش D-1404-003 می‌سازد (schema: «auto-generated سمت اپ»)
  const dispatchCode = typeof body?.dispatchCode === "string" ? body.dispatchCode : undefined;

  const result = Array.isArray(items)
    ? await createBackorderDispatch({ tenantId: c.tenantId, agentAccountId, createdByUserId: c.userId, dispatchCode, customerName, destination, items, customerId })
    : typeof salesRequestId === "string"
      ? await createDispatchFromRequest({ tenantId: c.tenantId, salesRequestId, createdByUserId: c.userId, dispatchCode, customerName, destination, customerId })
      : null;
  if (!result) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (!result.ok) {
    const status = result.reason === "request_not_found" ? 404 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }
  // v2 چندانباره: سفارشِ دوانباره دو حواله می‌شود، پس همیشه آرایه برمی‌گردد.
  // backorder هنوز تک‌حواله است (lot ندارد، پس انبارش هم معلوم نیست).
  const dispatchIds = "dispatchIds" in result ? result.dispatchIds : [result.dispatchId];
  return NextResponse.json({ dispatchIds }, { status: 201 });
}
