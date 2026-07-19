import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { currentUserId } from "@/auth/session";
import { authorizeTenantMember, AuthzError } from "@/auth/authz";
import { createDispatchFromRequest } from "@/db/dispatches";

/** GET /api/sales-dispatches?tenantId — لیست حواله‌ها برای پنل staff. */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const tenantId = new URL(req.url).searchParams.get("tenantId") ?? "";
  try {
    await authorizeTenantMember(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
  const dispatches = await withTenant(tenantId, (tx) =>
    tx`
      SELECT sd.id, sd.dispatch_code AS "dispatchCode", sd.status,
             sd.customer_name AS "customerName", count(sdi.id)::int AS items
      FROM sales_dispatch sd
      LEFT JOIN sales_dispatch_item sdi ON sdi.dispatch_id = sd.id
      WHERE sd.tenant_id = ${tenantId}
      GROUP BY sd.id
      ORDER BY sd.created_at DESC
      LIMIT 50`,
  );
  return NextResponse.json({ dispatches });
}

/**
 * POST /api/sales-dispatches — ساخت حواله از یک SalesRequestِ تأییدشده (کارِ staff).
 * dispatch همیشه توسط staff ساخته می‌شه، هرگز نماینده (spec ۵.۶).
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { tenantId, salesRequestId, dispatchCode, customerName, destination } = body ?? {};
  if (typeof tenantId !== "string" || typeof salesRequestId !== "string" || typeof dispatchCode !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await authorizeTenantMember(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const result = await createDispatchFromRequest({ tenantId, salesRequestId, createdByUserId: userId, dispatchCode, customerName, destination });
  if (!result.ok) {
    const status = result.reason === "request_not_found" ? 404 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ dispatchId: result.dispatchId }, { status: 201 });
}
