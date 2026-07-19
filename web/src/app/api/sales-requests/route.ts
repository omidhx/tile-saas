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
        COALESCE(json_agg(json_build_object(
          'name', p.name, 'code', p.code, 'qty', sri.requested_qty_boxes
        )) FILTER (WHERE sri.id IS NOT NULL), '[]') AS items
      FROM sales_request sr
      JOIN agent_account aa ON aa.id = sr.agent_account_id
      LEFT JOIN sales_request_item sri ON sri.request_id = sr.id
      LEFT JOIN product_variant pv ON pv.id = sri.variant_id
      LEFT JOIN product p ON p.id = pv.product_id
      WHERE sr.tenant_id = ${tenantId} AND sr.status = ${status}
      GROUP BY sr.id, aa.legal_name
      ORDER BY sr.created_at DESC
      LIMIT 50`,
  );
  return NextResponse.json({ requests });
}
