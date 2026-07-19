import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";

/** GET /api/catalog?tenantId — همه‌ی variantها (فرم backorder؛ برخلاف /api/lots محدود به موجودی نیست). */
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
  const variants = await withTenant(tenantId, (tx) =>
    tx`SELECT pv.id, p.name, p.code, pv.sku FROM product_variant pv
       JOIN product p ON p.id = pv.product_id
       WHERE pv.tenant_id = ${tenantId} ORDER BY p.name LIMIT 200`,
  );
  return NextResponse.json({ variants });
}
