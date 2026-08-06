import { withTenant } from "./client";

export type LowStockItem = { variantId: string; name: string; code: string; available: number };
export type DashboardKpis = {
  todayDispatches: number;
  todayBoxes: number;
  lowStock: LowStockItem[];
};

// ponytail: آستانه‌ی «رو به اتمام» عددِ ثابتِ ۱۰ کارتن است، نه چیزی که پرفروش‌ترین
// کالا را از کم‌فروش‌ترین تفکیک کند (مثلاً نسبت به میانگینِ فروشِ ماهانه). برای
// این نسخه‌ی داشبورد که فقط هشدارِ سریعِ چشمی است کافی است؛ اگر لازم شد، آستانه
// را per-tenant (مثل default_reservation_ttl_hours) بساز.
const LOW_STOCK_THRESHOLD = 10;

/**
 * KPIِ سریع برای صفحه‌ی اولِ پشتیبان — نه گزارشِ کامل (آن `/staff/reports` است)،
 * فقط چیزی که با یک نگاه باید دیده شود: امروز چقدر بار زده شده، و چه چیزی
 * دارد تمام می‌شود.
 */
export async function getDashboardKpis(tenantId: string): Promise<DashboardKpis> {
  return withTenant(tenantId, async (tx) => {
    const [today] = await tx<{ dispatches: number; boxes: number }[]>`
      SELECT
        count(DISTINCT sd.id)::int AS dispatches,
        COALESCE(SUM(-t.on_hand_delta_boxes), 0)::int AS boxes
      FROM inventory_transaction t
      JOIN sales_dispatch sd ON sd.id = t.reference_id AND t.reference_type = 'sales_dispatch'
      WHERE t.tenant_id = ${tenantId}
        AND t.transaction_type = 'dispatch_load'
        AND t.created_at >= date_trunc('day', now())`;

    // «رو به اتمام» یعنی موجودی کم است ولی صفر نیست — صفر از قبل در
    // «ناموجودها»ی نماینده (alerts.ts) دیده می‌شود؛ این‌جا هشدارِ زودتر است.
    const lowStock = await tx<LowStockItem[]>`
      SELECT pv.id AS "variantId", p.name, p.code, SUM(a.available_qty_boxes)::int AS available
      FROM v_lot_availability a
      JOIN inventory_lot l    ON l.id = a.lot_id
      JOIN product_variant pv ON pv.id = l.variant_id
      JOIN product p          ON p.id = pv.product_id
      WHERE a.tenant_id = ${tenantId}
      GROUP BY pv.id, p.name, p.code
      HAVING SUM(a.available_qty_boxes) > 0 AND SUM(a.available_qty_boxes) <= ${LOW_STOCK_THRESHOLD}
      ORDER BY available ASC
      LIMIT 8`;

    return { todayDispatches: today?.dispatches ?? 0, todayBoxes: today?.boxes ?? 0, lowStock };
  });
}
