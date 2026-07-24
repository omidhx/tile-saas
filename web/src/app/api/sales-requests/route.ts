import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";

/** GET /api/sales-requests?tenantId&status=approved — برای پنل staff (حواله‌سازی). */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const status = url.searchParams.get("status") ?? "approved";
  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
  const requests = await withTenant(tenantId, (tx) =>
    tx`
      SELECT sr.id, sr.status, sr.created_at AS "createdAt", aa.legal_name AS "agentName",
        sr.approval_mode AS "approvalMode",
        COALESCE(json_agg(json_build_object(
          'name', p.name, 'code', p.code, 'qty', sri.requested_qty_boxes
        )) FILTER (WHERE sri.id IS NOT NULL), '[]') AS items
      FROM sales_request sr
      JOIN agent_account aa ON aa.id = sr.agent_account_id
      LEFT JOIN sales_request_item sri ON sri.request_id = sr.id
      LEFT JOIN product_variant pv ON pv.id = sri.variant_id
      LEFT JOIN product p ON p.id = pv.product_id
      WHERE sr.tenant_id = ${tenantId} AND sr.status = ${status}
        -- سفارشی که حواله‌ی زنده دارد از صفِ «ساخت حواله» بیرون می‌رود — وگرنه دکمه
        -- برای همیشه می‌ماند و دو کلیک یعنی دو بار ارسالِ همان بار (لغوشده استثناست).
        AND NOT EXISTS (SELECT 1 FROM sales_dispatch sd
                        WHERE sd.tenant_id = sr.tenant_id AND sd.sales_request_id = sr.id
                          AND sd.status <> 'cancelled')
      GROUP BY sr.id, aa.legal_name, sr.approval_mode
      ORDER BY sr.created_at DESC
      LIMIT 50`,
  );
  return NextResponse.json({ requests });
}
