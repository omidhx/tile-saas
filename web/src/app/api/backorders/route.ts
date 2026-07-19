import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";

/** GET /api/backorders?tenantId — اقلام backorder برای پنل staff. */
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
  const items = await withTenant(tenantId, (tx) =>
    tx`
      SELECT sdi.id, sdi.backorder_status AS status, sdi.quantity_boxes AS qty,
             p.name, p.code, sd.dispatch_code AS "dispatchCode", aa.legal_name AS "agentName"
      FROM sales_dispatch_item sdi
      JOIN sales_dispatch sd ON sd.id = sdi.dispatch_id
      JOIN agent_account aa ON aa.id = sd.agent_account_id
      JOIN product_variant pv ON pv.id = sdi.variant_id
      JOIN product p ON p.id = pv.product_id
      WHERE sdi.tenant_id = ${tenantId} AND sdi.fulfillment_type = 'backorder'
      ORDER BY sd.created_at DESC
      LIMIT 100`,
  );
  return NextResponse.json({ items });
}
