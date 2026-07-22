import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { currentUserId } from "@/auth/session";
import { authorizeAgent, AuthzError } from "@/auth/authz";
import { resolvePrices } from "@/db/pricing";

// Lotهای قابل‌سفارش برای یک context. پشت chokepoint دسترسی + فیلترِ صریحِ tenant_id
// (belt & suspenders با RLS). فقط available>0 — نماینده available می‌بینه نه on_hand.
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const agentAccountId = url.searchParams.get("agentAccountId") ?? "";

  try {
    await authorizeAgent(userId, tenantId, agentAccountId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const lots = await withTenant(tenantId, (tx) =>
    tx<{
      lot_id: string; variant_id: string; name: string; code: string; grade: string | null;
      shade_code: string | null; caliber_code: string | null;
      available: number; boxes_per_pallet: number | null; sqcm_per_box: number | null;
      warehouse_id: string; warehouse_name: string;
      image_url: string | null; color: string | null; glaze: string | null; punch: string | null;
    }[]>`
      SELECT a.lot_id, l.variant_id, p.name, p.code, pv.grade, l.shade_code, l.caliber_code,
             a.available_qty_boxes AS available,
             COALESCE(l.boxes_per_pallet_override, pv.boxes_per_pallet) AS boxes_per_pallet,
             pv.sqcm_per_box,
             -- v2 چندانباره: نماینده باید بداند بار از کجا برداشته می‌شود (spec ۱۱.۲ «فیلتر: انبار»).
             -- bin_location عمداً نمی‌آید — برای نماینده نویز است (spec ۱۱.۴).
             l.warehouse_id, w.name AS warehouse_name,
             -- v2 کاتالوگ تصویری: عکس + ویژگی‌های محصول برای کارت و مودال
             p.image_url, p.color, p.glaze, p.punch
      FROM v_lot_availability a
      JOIN inventory_lot l    ON l.id = a.lot_id
      JOIN warehouse w        ON w.id = l.warehouse_id
      JOIN product_variant pv ON pv.id = l.variant_id
      JOIN product p          ON p.id = pv.product_id
      WHERE a.tenant_id = ${tenantId} AND a.available_qty_boxes > 0
      ORDER BY p.name, w.name`,
  );

  // «قیمت من» — قیمتِ همین نماینده (spec ۵.۷: نماینده‌ها نباید قیمت هم را ببینند).
  // یک کوئریِ بالک برای همه‌ی variantها، نه یکی به‌ازای هر قلم.
  const prices = await resolvePrices({
    tenantId, agentAccountId,
    variantIds: [...new Set(lots.map((l) => l.variant_id))],
  });

  return NextResponse.json({
    lots: lots.map((l) => ({ ...l, unitPrice: prices.get(l.variant_id)?.unitPrice ?? null })),
  });
}
