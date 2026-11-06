import { NextResponse } from "next/server";
import { z } from "zod";
import { staffCtx } from "@/auth/httpCtx";
import { id, positive, parse } from "@/lib/validate";
import { createDispatchFromRequest, createBackorderDispatch, listDispatches } from "@/db/dispatches";

/** GET /api/sales-dispatches?tenantId[&q][&offset] — لیستِ حواله‌ها برای پنل staff، صفحه‌بندی‌شده. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await staffCtx(u.searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const q = u.searchParams.get("q") ?? undefined;
  // منفی یا اعشاری به OFFSETِ Postgres می‌رسید و ۵۰۰ می‌داد
  const offset = Math.max(0, Math.trunc(Number(u.searchParams.get("offset") ?? "0") || 0));
  const { items: dispatches, hasMore } = await listDispatches({ tenantId: c.tenantId, q, offset });
  return NextResponse.json({ dispatches, hasMore });
}

// dispatchCode دیگر از کلاینت پذیرفته نمی‌شود: سرور خودش D-1404-003 می‌سازد. کدِ صریح
// همان راهی بود که E3-F8 با آن هشت حواله‌ی زنده برای یک درخواست ساخت.
const optText = z.string().nullish();
const Common = {
  customerName: optText, destination: optText, referenceNumber: optText,
  // customerId تنها شناسه‌ی قابل‌اعتماد است؛ customerName فقط برای caller قدیمی می‌ماند.
  customerId: id.or(z.literal("")).nullish(),
};
const FromRequest = z.object({ salesRequestId: id, ...Common });
const Backorder = z.object({
  agentAccountId: id,
  items: z.array(z.object({ variantId: id, quantityBoxes: positive })).min(1),
  ...Common,
});

/**
 * POST /api/sales-dispatches — ساخت حواله (staff-only، spec ۵.۶). دو حالت بر اساس body:
 *   • { salesRequestId }        → حواله از SalesRequestِ تأییدشده (اقلام in_stock)
 *   • { agentAccountId, items } → حواله‌ی مستقلِ backorder (محصول ناموجود، بیرون از موجودی)
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const p = parse(Array.isArray(body?.items) ? Backorder : FromRequest, body);
  if ("err" in p) return p.err;
  const d = p.data;
  const common = {
    tenantId: c.tenantId, createdByUserId: c.userId, customerName: d.customerName ?? undefined,
    destination: d.destination ?? undefined, customerId: d.customerId ?? undefined, referenceNumber: d.referenceNumber,
  };
  const result = "items" in d
    ? await createBackorderDispatch({ ...common, agentAccountId: d.agentAccountId, items: d.items })
    : await createDispatchFromRequest({ ...common, salesRequestId: d.salesRequestId });
  if (!result.ok) {
    const status = result.reason === "request_not_found" ? 404 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }
  // v2 چندانباره: سفارشِ دوانباره دو حواله می‌شود، پس همیشه آرایه برمی‌گردد.
  // backorder هنوز تک‌حواله است (lot ندارد، پس انبارش هم معلوم نیست).
  const dispatchIds = "dispatchIds" in result ? result.dispatchIds : [result.dispatchId];
  return NextResponse.json({ dispatchIds }, { status: 201 });
}
