import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { staffCtx } from "@/auth/httpCtx";

/**
 * GET /api/catalog?tenantId&q — همه‌ی variantها (فرم backorder و ورود کالا؛ برخلاف /api/lots محدود به موجودی نیست).
 * q روی نام، کد و sku جستجو می‌کند؛ بدون q فقط ۲۰۰ تای اول برمی‌گردد.
 */
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const c = await staffCtx(u.get("tenantId"));
  if ("err" in c) return c.err;
  const q = u.get("q")?.trim() ? `%${u.get("q")!.trim()}%` : null;
  const variants = await withTenant(c.tenantId, (tx) =>
    tx`SELECT pv.id, p.name, p.code, pv.sku, pv.grade, pv.boxes_per_pallet AS "boxesPerPallet" FROM product_variant pv
       JOIN product p ON p.id = pv.product_id
       WHERE pv.tenant_id = ${c.tenantId}
         ${q ? tx`AND (p.name ILIKE ${q} OR p.code ILIKE ${q} OR pv.sku ILIKE ${q})` : tx``}
       ORDER BY p.name, pv.grade NULLS FIRST LIMIT 200`,
  );
  return NextResponse.json({ variants });
}
