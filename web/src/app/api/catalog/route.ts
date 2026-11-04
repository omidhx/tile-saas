import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { staffCtx } from "@/auth/httpCtx";

/** GET /api/catalog?tenantId — همه‌ی variantها (فرم backorder؛ برخلاف /api/lots محدود به موجودی نیست). */
export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const variants = await withTenant(c.tenantId, (tx) =>
    tx`SELECT pv.id, p.name, p.code, pv.sku FROM product_variant pv
       JOIN product p ON p.id = pv.product_id
       WHERE pv.tenant_id = ${c.tenantId} ORDER BY p.name LIMIT 200`,
  );
  return NextResponse.json({ variants });
}
