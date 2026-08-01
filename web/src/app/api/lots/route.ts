import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { agentCtx } from "@/auth/httpCtx";
import { resolvePrices } from "@/db/pricing";

// Lotهای قابل‌سفارش برای یک context. پشت chokepoint دسترسی + فیلترِ صریحِ tenant_id
// (belt & suspenders با RLS). فقط available>0 — نماینده available می‌بینه نه on_hand.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const c = await agentCtx(url.searchParams.get("tenantId"), url.searchParams.get("agentAccountId"));
  if ("err" in c) return c.err;

  const lots = await withTenant(c.tenantId, (tx) =>
    tx<{
      lot_id: string; variant_id: string; name: string; code: string; grade: string | null;
      shade_code: string | null; caliber_code: string | null;
      available: number; boxes_per_pallet: number | null; sqcm_per_box: number | null;
      warehouse_id: string; warehouse_name: string;
      image_url: string | null; color: string | null; glaze: string | null;
      punch: string | null; body: string | null;
      size: string | null; thickness: string | null; usage_area: string | null; description: string | null;
      images: { id: string; url: string }[];
    }[]>`
      SELECT a.lot_id, l.variant_id, p.name, p.code, pv.grade, l.shade_code, l.caliber_code,
             a.available_qty_boxes AS available,
             COALESCE(l.boxes_per_pallet_override, pv.boxes_per_pallet) AS boxes_per_pallet,
             pv.sqcm_per_box,
             -- v2 چندانباره: نماینده باید بداند بار از کجا برداشته می‌شود (spec ۱۱.۲ «فیلتر: انبار»).
             -- bin_location عمداً نمی‌آید — برای نماینده نویز است (spec ۱۱.۴).
             l.warehouse_id, w.name AS warehouse_name,
             -- v2 کاتالوگ تصویری: عکس + ویژگی‌های محصول برای کارت و مودال
             p.image_url, p.color, p.glaze, p.punch, p.body,
             p.size, p.thickness, p.usage_area, p.description,
             COALESCE((
               SELECT json_agg(json_build_object('id', pi.id, 'url', pi.url) ORDER BY pi.sort_order, pi.id)
               FROM product_image pi WHERE pi.product_id = p.id
             ), '[]'::json) AS images
      FROM v_lot_availability a
      JOIN inventory_lot l    ON l.id = a.lot_id
      JOIN warehouse w        ON w.id = l.warehouse_id
      JOIN product_variant pv ON pv.id = l.variant_id
      JOIN product p          ON p.id = pv.product_id
      WHERE a.tenant_id = ${c.tenantId} AND a.available_qty_boxes > 0
      ORDER BY p.name, w.name`,
  );

  // «قیمت من» — قیمتِ همین نماینده (spec ۵.۷: نماینده‌ها نباید قیمت هم را ببینند).
  // یک کوئریِ بالک برای همه‌ی variantها، نه یکی به‌ازای هر قلم.
  const prices = await resolvePrices({
    tenantId: c.tenantId, agentAccountId: c.agentAccountId,
    variantIds: [...new Set(lots.map((l) => l.variant_id))],
  });

  return NextResponse.json({
    lots: lots.map((l) => ({ ...l, unitPrice: prices.get(l.variant_id)?.unitPrice ?? null })),
  });
}
