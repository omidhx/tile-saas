import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { createDispatchFromRequest, createBackorderDispatch } from "@/db/dispatches";

/** GET /api/sales-dispatches?tenantId — لیست حواله‌ها برای پنل staff. */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const tenantId = new URL(req.url).searchParams.get("tenantId") ?? "";
  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
  const dispatches = await withTenant(tenantId, (tx) =>
    tx`
      SELECT sd.id, sd.dispatch_code AS "dispatchCode", sd.status,
             sd.customer_name AS "customerName", count(sdi.id)::int AS items,
             -- انباردار باید بداند این حواله در کدام انبار بار می‌زند (backorder: NULL)
             w.name AS "warehouseName"
      FROM sales_dispatch sd
      LEFT JOIN sales_dispatch_item sdi ON sdi.dispatch_id = sd.id
      LEFT JOIN warehouse w ON w.id = sd.warehouse_id
      WHERE sd.tenant_id = ${tenantId}
      GROUP BY sd.id, w.name
      ORDER BY sd.created_at DESC
      LIMIT 50`,
  );
  return NextResponse.json({ dispatches });
}

/**
 * POST /api/sales-dispatches — ساخت حواله (staff-only، spec ۵.۶). دو حالت بر اساس body:
 *   • { salesRequestId }        → حواله از SalesRequestِ تأییدشده (اقلام in_stock)
 *   • { agentAccountId, items } → حواله‌ی مستقلِ backorder (محصول ناموجود، بیرون از موجودی)
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { tenantId, salesRequestId, agentAccountId, items, dispatchCode, customerName, destination, customerId } = body ?? {};
  if (typeof tenantId !== "string" || typeof dispatchCode !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const result = Array.isArray(items)
    ? await createBackorderDispatch({ tenantId, agentAccountId, createdByUserId: userId, dispatchCode, customerName, destination, items, customerId })
    : typeof salesRequestId === "string"
      ? await createDispatchFromRequest({ tenantId, salesRequestId, createdByUserId: userId, dispatchCode, customerName, destination, customerId })
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
