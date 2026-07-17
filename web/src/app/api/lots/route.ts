import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { currentUserId } from "@/auth/session";
import { authorizeAgent, AuthzError } from "@/auth/authz";

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
      lot_id: string; name: string; code: string; grade: string | null;
      shade_code: string | null; caliber_code: string | null;
      available: number; boxes_per_pallet: number | null;
    }[]>`
      SELECT a.lot_id, p.name, p.code, pv.grade, l.shade_code, l.caliber_code,
             a.available_qty_boxes AS available,
             COALESCE(l.boxes_per_pallet_override, pv.boxes_per_pallet) AS boxes_per_pallet
      FROM v_lot_availability a
      JOIN inventory_lot l    ON l.id = a.lot_id
      JOIN product_variant pv ON pv.id = l.variant_id
      JOIN product p          ON p.id = pv.product_id
      WHERE a.tenant_id = ${tenantId} AND a.available_qty_boxes > 0
      ORDER BY p.name`,
  );

  return NextResponse.json({ lots });
}
