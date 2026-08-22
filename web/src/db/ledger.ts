import { withTenant } from "./client";

/**
 * گزارشِ لجر — دلیلِ وجودِ لجر طبق spec ۵.۴: «بدون این لجر، وقتی کارخونه بپرسه چرا
 * موجودی این کالا اشتباهه، دیباگ کردن عملاً غیرممکنه.» تا حالا می‌نوشتیم و کسی
 * نمی‌خوندش؛ این‌جا خوانا می‌شه.
 */

export type Movement = {
  id: string; type: string; onHandDelta: number; allocatedDelta: number;
  refType: string | null; createdAt: string; note: string | null;
  name: string; code: string; batch: string | null; actor: string | null;
};

/**
 * حرکات اخیر (اختیاراً فیلترشده روی یک lot)، صفحه‌بندی‌شده + جستجو (کالا/کد/بچ) —
 * `inventory_transaction` append-only است و فقط بزرگ‌تر می‌شود؛ بدونِ صفحه‌بندی،
 * بعدِ چند ماه حرکتِ قدیمی از `LIMIT` ثابت بیرون می‌افتد و دیگر قابلِ دیدن نیست.
 */
export async function listMovements(p: {
  tenantId: string; lotId?: string; q?: string; limit?: number; offset?: number;
}): Promise<{ items: Movement[]; hasMore: boolean }> {
  const limit = p.limit ?? 100, offset = p.offset ?? 0, q = p.q?.trim();
  const rows = await withTenant(p.tenantId, (tx) =>
    tx<Movement[]>`
      SELECT t.id, t.transaction_type AS type,
             t.on_hand_delta_boxes AS "onHandDelta", t.allocated_delta_boxes AS "allocatedDelta",
             t.reference_type AS "refType", t.created_at AS "createdAt", t.note,
             p.name, p.code, l.batch_number AS batch, u.phone AS actor
      FROM inventory_transaction t
      JOIN inventory_lot l     ON l.id = t.lot_id
      JOIN product_variant pv  ON pv.id = l.variant_id
      JOIN product p           ON p.id = pv.product_id
      LEFT JOIN app_user u     ON u.id = t.actor_user_id
      WHERE t.tenant_id = ${p.tenantId}
        AND ${p.lotId ? tx`t.lot_id = ${p.lotId}` : tx`TRUE`}
        AND ${q ? tx`(p.name ILIKE ${"%" + q + "%"} OR p.code ILIKE ${"%" + q + "%"} OR l.batch_number ILIKE ${"%" + q + "%"})` : tx`TRUE`}
      ORDER BY t.created_at DESC
      LIMIT ${limit + 1} OFFSET ${offset}`,
  );
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

export type Drift = {
  lotId: string; name: string; code: string; batch: string | null;
  onHand: number; ledgerOnHand: number; allocated: number; ledgerAllocated: number;
};

/**
 * تطبیق لجر با موجودی: برای هر lot باید
 *   SUM(on_hand_delta)    == on_hand_qty_boxes
 *   SUM(allocated_delta)  == allocated_qty_boxes
 * هر ردیفی که برگرده یعنی موجودی از مسیری عوض شده که لجر ننوشته (مثلاً UPDATE دستی
 * روی دیتابیس، یا seedِ مستقیم). دقیقاً همون drift‌ی که لجر برای گرفتنش هست.
 * خروجیِ خالی = ترازِ کامل.
 */
export async function findDrift(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx<Drift[]>`
      SELECT l.id AS "lotId", p.name, p.code, l.batch_number AS batch,
             b.on_hand_qty_boxes AS "onHand",
             COALESCE(SUM(t.on_hand_delta_boxes), 0)::int AS "ledgerOnHand",
             b.allocated_qty_boxes AS "allocated",
             COALESCE(SUM(t.allocated_delta_boxes), 0)::int AS "ledgerAllocated"
      FROM inventory_lot l
      JOIN inventory_balance b ON b.lot_id = l.id
      JOIN product_variant pv  ON pv.id = l.variant_id
      JOIN product p           ON p.id = pv.product_id
      LEFT JOIN inventory_transaction t ON t.lot_id = l.id
      WHERE l.tenant_id = ${tenantId}
      GROUP BY l.id, p.name, p.code, l.batch_number, b.on_hand_qty_boxes, b.allocated_qty_boxes
      HAVING b.on_hand_qty_boxes    <> COALESCE(SUM(t.on_hand_delta_boxes), 0)
          OR b.allocated_qty_boxes  <> COALESCE(SUM(t.allocated_delta_boxes), 0)
      ORDER BY p.name`,
  );
}
