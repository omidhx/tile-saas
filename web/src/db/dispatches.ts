import { withTenant } from "./client";

export type CreateDispatchResult =
  /**
   * v2 چندانباره: **آرایه** است، چون سفارشی که از دو انبار تأمین شود به دو حواله
   * تقسیم می‌شود. تک‌انباره همان آرایه‌ی تک‌عضوی است.
   */
  | { ok: true; dispatchIds: string[] }
  | { ok: false; reason: "request_not_found" | "request_not_approved" | "no_allocations" };

export type DispatchStatus = "registered" | "ready_for_loading" | "loaded" | "delivered" | "cancelled";

export type SetStatusResult =
  | { ok: true; status: DispatchStatus }
  | { ok: false; reason: "not_found" | "invalid_transition" };

// گذارهای مجاز state machine (spec ۱۴.۳). loaded/delivered نهایی‌اند؛ loaded→cancelled ممنوع.
const NEXT: Record<DispatchStatus, DispatchStatus[]> = {
  registered: ["ready_for_loading", "cancelled"],
  ready_for_loading: ["loaded", "cancelled"],
  loaded: ["delivered"],
  delivered: [],
  cancelled: [],
};

/**
 * ساخت حواله از یک SalesRequestِ تأییدشده (کارِ staff). اقلام in_stock از allocationهای
 * request مشتق می‌شن (هر allocation → یک SalesDispatchItem با lot_id). موجودی اینجا تغییر
 * نمی‌کنه — allocated از قبل (در approve) بالا رفته؛ فقط موقع loaded فیزیکی کم می‌شه.
 */
export async function createDispatchFromRequest(params: {
  tenantId: string; salesRequestId: string; createdByUserId: string;
  dispatchCode: string; customerName?: string; destination?: string;
}): Promise<CreateDispatchResult> {
  const { tenantId, salesRequestId, createdByUserId, dispatchCode, customerName, destination } = params;
  return withTenant(tenantId, async (tx) => {
    const [req] = await tx<{ agent_account_id: string; status: string }[]>`
      SELECT agent_account_id, status FROM sales_request
      WHERE id = ${salesRequestId} AND tenant_id = ${tenantId}`;
    if (!req) return { ok: false, reason: "request_not_found" };
    if (req.status !== "approved") return { ok: false, reason: "request_not_approved" };

    type Alloc = { lot_id: string; variant_id: string; qty: number; warehouse_id: string; warehouse_code: string };
    const allocs = await tx<Alloc[]>`
      SELECT sra.lot_id, sri.variant_id, sra.allocated_qty_boxes AS qty,
             l.warehouse_id, w.code AS warehouse_code
      FROM sales_request_allocation sra
      JOIN sales_request_item sri ON sri.id = sra.sales_request_item_id
      JOIN inventory_lot l ON l.id = sra.lot_id
      JOIN warehouse w ON w.id = l.warehouse_id
      WHERE sri.request_id = ${salesRequestId} AND sra.tenant_id = ${tenantId}
      ORDER BY w.code, sra.lot_id`;
    if (allocs.length === 0) return { ok: false, reason: "no_allocations" };

    // v2 چندانباره: یک حواله به‌ازای هر انبار. حواله یعنی یک کامیون که در یک نقطه
    // بار می‌زند؛ حواله‌ی دوانباره لیستِ برداشتی می‌داد که نصفش آنجا نیست.
    const byWarehouse = new Map<string, Alloc[]>();
    for (const a of allocs) {
      const list = byWarehouse.get(a.warehouse_id) ?? [];
      list.push(a);
      byWarehouse.set(a.warehouse_id, list);
    }

    const dispatchIds: string[] = [];
    for (const [warehouseId, group] of byWarehouse) {
      // کدِ حواله وقتی تقسیم شد باید یکتا **و** برای انباردار معنادار بماند، پس با
      // کدِ انبار پسوند می‌گیرد (D-1404-001-W2) نه یک شماره‌ی بی‌معنا.
      const code = byWarehouse.size === 1 ? dispatchCode : `${dispatchCode}-${group[0].warehouse_code}`;
      const [d] = await tx<{ id: string }[]>`
        INSERT INTO sales_dispatch
          (tenant_id, sales_request_id, agent_account_id, dispatch_code, warehouse_id,
           customer_name, destination, status, created_by_user_id)
        VALUES (${tenantId}, ${salesRequestId}, ${req.agent_account_id}, ${code}, ${warehouseId},
                ${customerName ?? null}, ${destination ?? null}, 'registered', ${createdByUserId})
        RETURNING id`;
      for (const a of group)
        await tx`
          INSERT INTO sales_dispatch_item
            (tenant_id, dispatch_id, lot_id, fulfillment_type, variant_id, quantity_boxes, warehouse_id)
          VALUES (${tenantId}, ${d.id}, ${a.lot_id}, 'in_stock', ${a.variant_id}, ${a.qty}, ${a.warehouse_id})`;
      dispatchIds.push(d.id);
    }
    return { ok: true, dispatchIds };
  });
}

/**
 * گذارِ وضعیت حواله. ردیف dispatch با FOR UPDATE قفل می‌شه (سریالایز، ضدِ double-transition).
 *   • loaded  (از ready_for_loading): برای هر item in_stock، balance را قفل و on_hand-=qty و
 *     allocated-=qty. idempotent چون فقط از ready_for_loading اثر می‌ذاره — retry بعد از loaded
 *     گذارِ نامجاز می‌شه و دوباره کم نمی‌کنه.
 *   • cancelled (قبل از loaded): allocated آزاد می‌شه (allocated-=qty)، on_hand دست‌نخورده؛
 *     request مرتبط هم cancelled می‌شه (سازگاری allocated).
 */
export async function setDispatchStatus(params: {
  tenantId: string; dispatchId: string; toStatus: DispatchStatus; actorUserId: string;
}): Promise<SetStatusResult> {
  const { tenantId, dispatchId, toStatus, actorUserId } = params;
  return withTenant(tenantId, async (tx) => {
    const [d] = await tx<{ status: DispatchStatus; sales_request_id: string | null }[]>`
      SELECT status, sales_request_id FROM sales_dispatch
      WHERE id = ${dispatchId} AND tenant_id = ${tenantId} FOR UPDATE`;
    if (!d) return { ok: false, reason: "not_found" };
    if (!NEXT[d.status].includes(toStatus)) return { ok: false, reason: "invalid_transition" };

    if (toStatus === "loaded" || toStatus === "cancelled") {
      const items = await tx<{ lot_id: string; quantity_boxes: number }[]>`
        SELECT lot_id, quantity_boxes FROM sales_dispatch_item
        WHERE dispatch_id = ${dispatchId} AND tenant_id = ${tenantId} AND fulfillment_type = 'in_stock'
        ORDER BY lot_id`;
      const lotIds = items.map((i) => i.lot_id);
      if (lotIds.length > 0)
        // فیلترِ صریحِ tenant_id در کنار RLS (قانون معماری #۶: با هم، نه یکی به‌جای اون یکی)
        await tx`SELECT lot_id FROM inventory_balance WHERE tenant_id = ${tenantId} AND lot_id IN ${tx(lotIds)} ORDER BY lot_id FOR UPDATE`;

      for (const it of items) {
        if (toStatus === "loaded") {
          // بارگیری فیزیکی: on_hand و allocated هر دو کم می‌شن (اتمیک با لجر)
          await tx`
            UPDATE inventory_balance
            SET on_hand_qty_boxes = on_hand_qty_boxes - ${it.quantity_boxes},
                allocated_qty_boxes = allocated_qty_boxes - ${it.quantity_boxes}
            WHERE lot_id = ${it.lot_id} AND tenant_id = ${tenantId}`;
          await tx`
            INSERT INTO inventory_transaction
              (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, allocated_delta_boxes, reference_type, reference_id, actor_user_id)
            VALUES (${tenantId}, ${it.lot_id}, 'dispatch_load', ${-it.quantity_boxes}, ${-it.quantity_boxes},
                    'sales_dispatch', ${dispatchId}, ${actorUserId})`;
        } else {
          // لغو قبل از بارگیری: فقط allocated آزاد می‌شه (کالا هنوز فیزیکی موجوده)
          await tx`
            UPDATE inventory_balance SET allocated_qty_boxes = allocated_qty_boxes - ${it.quantity_boxes}
            WHERE lot_id = ${it.lot_id} AND tenant_id = ${tenantId}`;
          await tx`
            INSERT INTO inventory_transaction
              (tenant_id, lot_id, transaction_type, allocated_delta_boxes, reference_type, reference_id, actor_user_id)
            VALUES (${tenantId}, ${it.lot_id}, 'dispatch_cancel', ${-it.quantity_boxes},
                    'sales_dispatch', ${dispatchId}, ${actorUserId})`;
        }
      }
      if (toStatus === "cancelled" && d.sales_request_id)
        await tx`UPDATE sales_request SET status = 'cancelled' WHERE id = ${d.sales_request_id} AND tenant_id = ${tenantId}`;
    }

    await tx`UPDATE sales_dispatch SET status = ${toStatus} WHERE id = ${dispatchId} AND tenant_id = ${tenantId}`;
    return { ok: true, status: toStatus };
  });
}

// ---------------------------------------------------------------------------
// مسیر Backorder (محصول ناموجود) — spec ۵.۶
// ---------------------------------------------------------------------------
// کاملاً بیرون از محاسبه‌ی موجودی: lot_id = NULL، هیچ held/allocated/on_hand و هیچ لجری.
// یه تعهدِ «بعداً تولید/وارد می‌شه»؛ چرخه‌اش روی backorder_status هر item است.

export type BackorderStatus = "pending_production" | "ready" | "fulfilled" | "cancelled";

const BO_NEXT: Record<BackorderStatus, BackorderStatus[]> = {
  pending_production: ["ready", "cancelled"],
  ready: ["fulfilled", "cancelled"],
  fulfilled: [], cancelled: [],
};

/** حواله‌ی مستقلِ backorder (بدون SalesRequest). هیچ ردیف موجودی‌ای را دست نمی‌زند. */
export async function createBackorderDispatch(params: {
  tenantId: string; agentAccountId: string; createdByUserId: string;
  dispatchCode: string; customerName?: string; destination?: string;
  items: { variantId: string; quantityBoxes: number }[];
}): Promise<{ ok: true; dispatchId: string } | { ok: false; reason: "no_items" | "bad_qty" }> {
  const { tenantId, agentAccountId, createdByUserId, dispatchCode, customerName, destination, items } = params;
  if (items.length === 0) return { ok: false, reason: "no_items" };
  if (items.some((i) => !Number.isInteger(i.quantityBoxes) || i.quantityBoxes <= 0)) return { ok: false, reason: "bad_qty" };
  return withTenant(tenantId, async (tx) => {
    const [d] = await tx<{ id: string }[]>`
      INSERT INTO sales_dispatch
        (tenant_id, sales_request_id, agent_account_id, dispatch_code, customer_name, destination, status, created_by_user_id)
      VALUES (${tenantId}, NULL, ${agentAccountId}, ${dispatchCode}, ${customerName ?? null}, ${destination ?? null}, 'registered', ${createdByUserId})
      RETURNING id`;
    for (const it of items)
      await tx`
        INSERT INTO sales_dispatch_item
          (tenant_id, dispatch_id, lot_id, fulfillment_type, backorder_status, variant_id, quantity_boxes)
        VALUES (${tenantId}, ${d.id}, NULL, 'backorder', 'pending_production', ${it.variantId}, ${it.quantityBoxes})`;
    return { ok: true, dispatchId: d.id };
  });
}

/** گذارِ backorder_status یک item (pending_production → ready → fulfilled | cancelled). بدون اثر موجودی. */
export async function setBackorderItemStatus(params: {
  tenantId: string; dispatchItemId: string; toStatus: BackorderStatus;
}): Promise<{ ok: true; status: BackorderStatus } | { ok: false; reason: "not_found" | "invalid_transition" }> {
  const { tenantId, dispatchItemId, toStatus } = params;
  return withTenant(tenantId, async (tx) => {
    const [it] = await tx<{ backorder_status: BackorderStatus; fulfillment_type: string }[]>`
      SELECT backorder_status, fulfillment_type FROM sales_dispatch_item
      WHERE id = ${dispatchItemId} AND tenant_id = ${tenantId} FOR UPDATE`;
    if (!it || it.fulfillment_type !== "backorder") return { ok: false, reason: "not_found" };
    if (!BO_NEXT[it.backorder_status].includes(toStatus)) return { ok: false, reason: "invalid_transition" };
    await tx`UPDATE sales_dispatch_item SET backorder_status = ${toStatus} WHERE id = ${dispatchItemId} AND tenant_id = ${tenantId}`;
    return { ok: true, status: toStatus };
  });
}
