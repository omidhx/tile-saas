import { createHash } from "node:crypto";
import { withTenant } from "./client";

export type ReserveItem = { lotId: string; quantityBoxes: number };
export type ReserveResult =
  | { ok: true; reservationId: string; deduped: boolean }
  | { ok: false; conflict: { lotId: string; requested: number; available: number } }
  | { ok: false; idempotencyMismatch: true };

/**
 * الگوریتم رزرو — پیاده‌سازی مرجعِ بخش ۶ spec. همه‌ی قوانین معماری اینجا هم‌گرا می‌شن:
 *   #۱ held محاسباتی (SUM)، هرگز ستون کش‌شده
 *   #۲ available >= requested اجباری، بدون استثنا
 *   #۳ all-or-nothing (یا کل سبد یا هیچ)
 *   #۴ قفل ORDER BY lot_id (جلوی deadlock)
 * raw SQL عمدیه: مسیر قفل باید دقیق باشه، query-builder اینجا فقط ابهام می‌سازه.
 *
 * برمی‌گردونه: ok:false با conflict یعنی ۴۰۹ (کلاینت پیام «موجودی فعلی: X» می‌سازه).
 */
export async function reserve(params: {
  tenantId: string;
  agentAccountId: string;
  ttlHours: number;
  idempotencyKey: string;
  items: ReserveItem[];
}): Promise<ReserveResult> {
  const { tenantId, agentAccountId, ttlHours, idempotencyKey, items } = params;
  if (items.length === 0) throw new Error("رزرو خالی مجاز نیست");

  // اقلام هم‌lot را جمع و بر اساس lot_id مرتب کن — قفل همیشه ORDER BY lot_id (#۴)
  const byLot = new Map<string, number>();
  for (const it of items) {
    if (!Number.isInteger(it.quantityBoxes) || it.quantityBoxes <= 0)
      throw new Error("تعداد باید عدد صحیح مثبت باشه");
    byLot.set(it.lotId, (byLot.get(it.lotId) ?? 0) + it.quantityBoxes);
  }
  const lotIds = [...byLot.keys()].sort();
  // هشِ payload نرمال‌شده: تشخیصِ «همون کلید، body متفاوت» (lotIds مرتب پس قطعیه)
  const requestHash = createHash("sha256")
    .update(agentAccountId + "|" + lotIds.map((l) => `${l}:${byLot.get(l)}`).join(","))
    .digest("hex");

  return withTenant(tenantId, async (tx) => {
    // ۱. idempotency: کلید تکراری → رزرو موجود را برگردون (بخش ۶: ۲۰۰ نه ۴۰۹، نه رزرو دوباره)
    const existing = await tx<{ id: string; idempotency_request_hash: string | null }[]>`
      SELECT id, idempotency_request_hash FROM reservation
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${idempotencyKey}`;
    if (existing.length > 0)
      // همون کلید + همون payload → همون رزرو (۲۰۰). کلید تکراری + payload متفاوت → ۴۰۹، نه رزرو بی‌سروصدا
      return existing[0].idempotency_request_hash === requestHash
        ? { ok: true, reservationId: existing[0].id, deduped: true }
        : { ok: false, idempotencyMismatch: true };

    // ۲. قفل balanceها با ORDER BY lot_id FOR UPDATE — این ردیف‌ها تنها mutexِ lotها هستن (#۴)
    const balances = await tx<
      { lot_id: string; on_hand_qty_boxes: number; allocated_qty_boxes: number; blocked_qty_boxes: number }[]
    >`
      SELECT lot_id, on_hand_qty_boxes, allocated_qty_boxes, blocked_qty_boxes
      FROM inventory_balance
      WHERE lot_id IN ${tx(lotIds)}
      ORDER BY lot_id
      FOR UPDATE`;
    if (balances.length !== lotIds.length)
      throw new Error("یک یا چند lot ردیف balance نداره");

    // ۳+۴. held با SUM (پس از قفل، پس consistent)؛ available>=requested برای همه (#۱،#۲،#۳)
    for (const b of balances) {
      const [{ held }] = await tx<{ held: string }[]>`
        SELECT COALESCE(SUM(ri.quantity_boxes), 0) AS held
        FROM reservation_item ri JOIN reservation r ON r.id = ri.reservation_id
        WHERE ri.lot_id = ${b.lot_id} AND r.status = 'active' AND r.expires_at > now()`;
      const available =
        b.on_hand_qty_boxes - Number(held) - b.allocated_qty_boxes - b.blocked_qty_boxes;
      const requested = byLot.get(b.lot_id)!;
      if (available < requested)
        // return (نه throw): چیزی ننوشتیم، commitِ خالی فقط قفل‌ها را آزاد می‌کنه. کل رزرو رد شد (#۳)
        return { ok: false, conflict: { lotId: b.lot_id, requested, available } };
    }

    // ۵. ثبت reservation + itemها
    const [resv] = await tx<{ id: string }[]>`
      INSERT INTO reservation (tenant_id, agent_account_id, expires_at, idempotency_key, idempotency_request_hash)
      VALUES (${tenantId}, ${agentAccountId}, now() + make_interval(hours => ${ttlHours}), ${idempotencyKey}, ${requestHash})
      RETURNING id`;
    for (const lotId of lotIds)
      await tx`
        INSERT INTO reservation_item (tenant_id, reservation_id, lot_id, quantity_boxes)
        VALUES (${tenantId}, ${resv.id}, ${lotId}, ${byLot.get(lotId)!})`;

    // ۶. لجر (hold: on_hand/allocated عوض نمی‌شه چون held محاسباتیه — فقط ردپای audit)
    for (const lotId of lotIds)
      await tx`
        INSERT INTO inventory_transaction
          (tenant_id, lot_id, transaction_type, reference_type, reference_id, note)
        VALUES (${tenantId}, ${lotId}, 'reservation_hold', 'reservation', ${resv.id},
                ${"held " + byLot.get(lotId)!})`;

    // ۷. COMMIT خودکار در پایان begin()
    return { ok: true, reservationId: resv.id, deduped: false };
  });
}
