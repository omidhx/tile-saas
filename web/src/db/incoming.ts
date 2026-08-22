import { withTenant } from "./client";
import { advanceWaitlist } from "./waitlist";
import { enqueueRestockNotifications } from "./alerts";

/**
 * موجودی در راه / پیش‌فروش تولید (v2، spec ۹) — «فلوی کامل‌تر از فلگ ساده».
 *
 * **قیدِ سخت: این هرگز وارد `available` نمی‌شود.** معادله‌ی
 * `available = on_hand − held − allocated − blocked` دست‌نخورده می‌ماند (spec ۱۹۸).
 * اگر موجودیِ نیامده available حساب می‌شد، نماینده روی چیزی سفارش می‌داد که وجود
 * ندارد و اولین کسی که واقعاً بار می‌خواست دستش خالی می‌ماند.
 *
 * پس این «موجودیِ دوم» نیست؛ یک **تعهدِ زمان‌دار** است. چیزی که در v1 کم بود
 * همان «کِی» بود: backorder فقط می‌گفت «در انتظار تولید».
 */

export type IncomingStatus = "planned" | "confirmed" | "arrived" | "cancelled";

export type IncomingRow = {
  id: string; variantId: string; name: string; code: string;
  warehouseId: string; warehouseName: string;
  quantityBoxes: number; expectedAt: string;
  source: string; status: IncomingStatus; note: string | null;
};

/** آنچه نماینده می‌بیند: فقط محموله‌های زنده، نه رسیده/لغوشده. */
export type ExpectedArrival = {
  quantityBoxes: number; expectedAt: string; status: "planned" | "confirmed";
};

export async function listIncoming(tenantId: string, opts?: { includeDone?: boolean }) {
  return withTenant(tenantId, (tx) => tx<IncomingRow[]>`
    SELECT i.id, i.variant_id AS "variantId", p.name, p.code,
           i.warehouse_id AS "warehouseId", w.name AS "warehouseName",
           i.quantity_boxes AS "quantityBoxes", i.expected_at AS "expectedAt",
           i.source, i.status, i.note
    FROM incoming_stock i
    JOIN product_variant pv ON pv.id = i.variant_id
    JOIN product p          ON p.id = pv.product_id
    JOIN warehouse w        ON w.id = i.warehouse_id
    WHERE i.tenant_id = ${tenantId}
      AND ${opts?.includeDone ? tx`TRUE` : tx`i.status IN ('planned','confirmed')`}
    ORDER BY i.expected_at, p.name`);
}

/**
 * محموله‌های در راهِ هر variant — برای نشان دادن به نماینده کنارِ کالای ناموجود.
 * `arrived`/`cancelled` نمی‌آیند: وعده‌ای که گذشته یا لغو شده، وعده نیست.
 */
export async function expectedArrivals(p: { tenantId: string; variantIds: string[] }) {
  if (p.variantIds.length === 0) return {};
  return withTenant(p.tenantId, async (tx) => {
    const rows = await tx<{ variantId: string; quantityBoxes: number; expectedAt: string; status: "planned" | "confirmed" }[]>`
      SELECT variant_id AS "variantId", quantity_boxes AS "quantityBoxes",
             expected_at AS "expectedAt", status
      FROM incoming_stock
      WHERE tenant_id = ${p.tenantId} AND variant_id IN ${tx(p.variantIds)}
        AND status IN ('planned','confirmed')
      ORDER BY expected_at`;
    const out: Record<string, ExpectedArrival[]> = {};
    for (const r of rows)
      (out[r.variantId] ??= []).push({
        quantityBoxes: r.quantityBoxes, expectedAt: r.expectedAt, status: r.status,
      });
    return out;
  });
}

export async function addIncoming(p: {
  tenantId: string; variantId: string; warehouseId: string;
  quantityBoxes: number; expectedAt: string; source?: string; note?: string | null;
}) {
  if (!Number.isInteger(p.quantityBoxes) || p.quantityBoxes <= 0)
    throw new Error("تعداد باید عدد صحیح مثبت باشد");
  await withTenant(p.tenantId, (tx) => tx`
    INSERT INTO incoming_stock (tenant_id, variant_id, warehouse_id, quantity_boxes, expected_at, source, note)
    VALUES (${p.tenantId}, ${p.variantId}, ${p.warehouseId}, ${p.quantityBoxes},
            ${p.expectedAt}, ${p.source ?? "production"}, ${p.note ?? null})`);
}

export type ArriveResult =
  | { ok: true; lotId: string; offers: number; notified: number }
  | { ok: false; reason: "not_found" | "not_pending" };

/**
 * محموله رسید → موجودیِ واقعی می‌شود.
 *
 * از **همان مسیرِ لجر** عبور می‌کند که import عبور می‌کند (`inventory_transaction`
 * در همان تراکنشِ `inventory_balance`)، نه یک UPDATE مستقیم — وگرنه گزارشِ تطبیق
 * بلافاصله ناترازی نشان می‌داد.
 *
 * و چون موجودی آزاد شده، همان کارهایی که import می‌کند اینجا هم لازم است:
 * صف انتظار جلو برود و «موجود شد» صف شود. بدون این، محموله می‌رسید و کسی که
 * ماه‌ها منتظرش بود خبردار نمی‌شد.
 */
export async function markArrived(p: {
  tenantId: string; id: string; actorUserId: string; batchNumber?: string | null;
}): Promise<ArriveResult> {
  return withTenant(p.tenantId, async (tx) => {
    // قفلِ ردیف: دو «رسید»ِ هم‌زمان نباید دو بار موجودی اضافه کنند
    const [inc] = await tx<{
      id: string; variant_id: string; warehouse_id: string; quantity_boxes: number; status: string;
    }[]>`
      SELECT id, variant_id, warehouse_id, quantity_boxes, status
      FROM incoming_stock
      WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
      FOR UPDATE`;
    if (!inc) return { ok: false, reason: "not_found" as const };
    if (inc.status !== "planned" && inc.status !== "confirmed")
      return { ok: false, reason: "not_pending" as const };

    // lot: اگر بچِ هم‌نام در همان انبار هست به آن اضافه کن، وگرنه بساز.
    // همان قاعده‌ی import، تا محموله‌ی دوم از یک بچ lotِ تکراری نسازد.
    let [lot] = await tx<{ id: string }[]>`
      SELECT id FROM inventory_lot
      WHERE tenant_id = ${p.tenantId} AND variant_id = ${inc.variant_id}
        AND warehouse_id = ${inc.warehouse_id}
        AND batch_number IS NOT DISTINCT FROM ${p.batchNumber ?? null}`;
    if (!lot) {
      [lot] = await tx<{ id: string }[]>`
        INSERT INTO inventory_lot (tenant_id, variant_id, warehouse_id, batch_number)
        VALUES (${p.tenantId}, ${inc.variant_id}, ${inc.warehouse_id}, ${p.batchNumber ?? null})
        RETURNING id`;
      await tx`
        INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes)
        VALUES (${p.tenantId}, ${lot.id}, 0)`;
    }

    await tx`
      UPDATE inventory_balance SET on_hand_qty_boxes = on_hand_qty_boxes + ${inc.quantity_boxes}
      WHERE tenant_id = ${p.tenantId} AND lot_id = ${lot.id}`;
    await tx`
      INSERT INTO inventory_transaction
        (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, reference_type, reference_id, actor_user_id, note)
      VALUES (${p.tenantId}, ${lot.id}, 'incoming_arrival', ${inc.quantity_boxes},
              'incoming_stock', ${inc.id}, ${p.actorUserId}, ${"رسیدنِ محموله‌ی در راه"})`;

    await tx`
      UPDATE incoming_stock
      SET status = 'arrived', arrived_lot_id = ${lot.id}, arrived_at = now()
      WHERE id = ${inc.id}`;

    // موجودی همین حالا آزاد شد — صف حقِ تقدم دارد، بعد اعلانِ عمومی.
    const offers = await advanceWaitlist(tx, p.tenantId, [inc.variant_id]);
    const notified = await enqueueRestockNotifications(tx, p.tenantId, [lot.id]);

    return { ok: true as const, lotId: lot.id, offers: offers.length, notified };
  });
}

/** فقط بینِ وضعیت‌های زنده. محموله‌ی رسیده برگشت‌پذیر نیست — موجودی‌اش در لجر نشسته. */
export async function setIncomingStatus(p: {
  tenantId: string; id: string; status: "planned" | "confirmed" | "cancelled";
}) {
  await withTenant(p.tenantId, (tx) => tx`
    UPDATE incoming_stock SET status = ${p.status}
    WHERE id = ${p.id} AND tenant_id = ${p.tenantId}
      AND status IN ('planned','confirmed')`);
}
