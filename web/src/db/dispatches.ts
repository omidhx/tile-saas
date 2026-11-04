import { withTenant } from "./client";
import { toJalali } from "@/lib/date";

export type CreateDispatchResult =
  /**
   * v2 چندانباره: **آرایه** است، چون سفارشی که از دو انبار تأمین شود به دو حواله
   * تقسیم می‌شود. تک‌انباره همان آرایه‌ی تک‌عضوی است.
   */
  | { ok: true; dispatchIds: string[] }
  | { ok: false; reason: "request_not_found" | "request_not_approved" | "no_allocations" | "already_dispatched" };

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/** رشته‌ی خالی/فقط‌فاصله یا نبودِ فیلد → null، نه ""‌ در ستون. */
const norm = (s?: string | null) => s?.trim() || null;

export type DispatchListItem = {
  id: string; dispatchCode: string; status: DispatchStatus;
  customerName: string | null; destination: string | null; referenceNumber: string | null;
  items: number; warehouseName: string | null;
};

/**
 * فهرستِ حواله‌ها برای پنلِ staff — صفحه‌بندی‌شده و اختیاراً فیلترشده با جستجو
 * (کدِ حواله/نامِ مشتری/نمایندگی)، چون بدونِ آن بعدِ چند ماه کار، `LIMIT` ثابت
 * حواله‌های قدیمی را از دیدِ پشتیبان کاملاً بیرون می‌انداخت — نه خطا، نه نشانه،
 * فقط دیگر «آنجا» نبودند.
 *
 * الگوی limit+1: یک ردیفِ اضافه می‌گیریم؛ اگر برگشت یعنی صفحه‌ی بعدی هست
 * (`hasMore`) — بدونِ یک COUNT(*) جداگانه روی جدولی که می‌تواند بزرگ باشد.
 */
export async function listDispatches(p: {
  tenantId: string; q?: string; limit?: number; offset?: number;
}): Promise<{ items: DispatchListItem[]; hasMore: boolean }> {
  const limit = p.limit ?? 50, offset = p.offset ?? 0, q = p.q?.trim();
  const rows = await withTenant(p.tenantId, (tx) =>
    tx<DispatchListItem[]>`
      SELECT sd.id, sd.dispatch_code AS "dispatchCode", sd.status,
             sd.customer_name AS "customerName", sd.destination, sd.reference_number AS "referenceNumber",
             count(sdi.id)::int AS items, w.name AS "warehouseName"
      FROM sales_dispatch sd
      LEFT JOIN sales_dispatch_item sdi ON sdi.dispatch_id = sd.id
      LEFT JOIN warehouse w ON w.id = sd.warehouse_id
      LEFT JOIN agent_account aa ON aa.id = sd.agent_account_id
      WHERE sd.tenant_id = ${p.tenantId}
        AND ${q ? tx`(sd.dispatch_code ILIKE ${"%" + q + "%"} OR sd.customer_name ILIKE ${"%" + q + "%"} OR aa.legal_name ILIKE ${"%" + q + "%"})` : tx`TRUE`}
      GROUP BY sd.id, w.name
      ORDER BY sd.created_at DESC
      LIMIT ${limit + 1} OFFSET ${offset}`,
  );
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

/**
 * کدِ بعدیِ حواله برای این tenant: D-1404-003 (یا BO-... برای backorder).
 * schema از اول گفته «auto-generated سمت اپ» ولی فرانت `D-${Date.now()}` می‌فرستاد —
 * یعنی انباردار با «D-1784885047336» کار می‌کرد، نه شماره‌ای که بشود تلفنی خواند.
 * suffixهای چندانباره (-W1) با regexp نادیده گرفته می‌شوند تا شماره تکرار نشود.
 */
async function nextDispatchCode(tx: Tx, tenantId: string, prefix: "D" | "BO"): Promise<string> {
  const jy = toJalali(new Date()).jy;
  const pattern = `^${prefix}-${jy}-(\\d+)`;
  const [{ m }] = await tx<{ m: number }[]>`
    SELECT COALESCE(MAX((regexp_match(dispatch_code, ${pattern}))[1]::int), 0) AS m
    FROM sales_dispatch WHERE tenant_id = ${tenantId}`;
  // ponytail: بدونِ قفل — دو ساختِ هم‌زمان در یک tenant به UNIQUE می‌خورند و یکی 500
  // می‌گیرد؛ با چند پشتیبانِ انسانی عملاً رخ نمی‌دهد. اگر داد، advisory lock اضافه شود.
  return `${prefix}-${jy}-${String(m + 1).padStart(3, "0")}`;
}

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
  /** ندهید تا خودکار ساخته شود (D-1404-003)؛ تست/seed می‌توانند صریح بدهند. */
  dispatchCode?: string; customerName?: string; destination?: string;
  /** v2: مشتری Entity شد. customerName همچنان snapshotِ نام است. */
  customerId?: string;
  /** v10: شماره‌ی دفتر/مرجعِ داخلیِ پشتیبان — فقط ذخیره و روی چاپ نمایش داده می‌شود. */
  referenceNumber?: string | null;
}): Promise<CreateDispatchResult> {
  const { tenantId, salesRequestId, createdByUserId, customerName, destination, customerId, referenceNumber } = params;
  return withTenant(tenantId, async (tx) => {
    const [req] = await tx<{ agent_account_id: string; status: string }[]>`
      SELECT agent_account_id, status FROM sales_request
      WHERE id = ${salesRequestId} AND tenant_id = ${tenantId}`;
    if (!req) return { ok: false, reason: "request_not_found" };
    if (req.status !== "approved") return { ok: false, reason: "request_not_approved" };

    // گاردِ حواله‌ی تکراری: بدونِ این، دو کلیک روی «ساخت حواله» یعنی دو بار ارسالِ
    // همان سفارش. لغوشده استثناست — حواله‌ی لغوشده باید قابلِ ساختِ دوباره باشد.
    const [dup] = await tx<{ id: string }[]>`
      SELECT id FROM sales_dispatch
      WHERE tenant_id = ${tenantId} AND sales_request_id = ${salesRequestId} AND status <> 'cancelled'
      LIMIT 1`;
    if (dup) return { ok: false, reason: "already_dispatched" };

    const dispatchCode = params.dispatchCode ?? await nextDispatchCode(tx, tenantId, "D");

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
           customer_name, customer_id, destination, reference_number, status, created_by_user_id)
        VALUES (${tenantId}, ${salesRequestId}, ${req.agent_account_id}, ${code}, ${warehouseId},
                ${customerName ?? null}, ${norm(customerId)}, ${norm(destination)}, ${norm(referenceNumber)},
                'registered', ${createdByUserId})
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

export type DispatchDetail = {
  dispatchCode: string; status: DispatchStatus; customerName: string | null;
  destination: string | null; referenceNumber: string | null;
  agentLegalName: string; warehouseName: string | null; createdAt: string;
  items: {
    productName: string; productCode: string; sku: string; grade: string | null;
    batchNumber: string | null; shadeCode: string | null; caliberCode: string | null;
    binLocation: string | null; quantityBoxes: number;
  }[];
  /** v11 «مبلغِ خرید به حروف روی فاکتور»: null یعنی هیچ قلمی قیمتِ ثبت‌شده نداشت. */
  totalValue: number | null;
};

/** برگه‌ی چاپیِ حواله (لیستِ برداشتِ انباردار + فاکتور): سرِ حواله + هر قلم با بچ/شید/کالیبر/بین + جمعِ مبلغ. */
export async function getDispatchDetail(tenantId: string, dispatchId: string): Promise<DispatchDetail | null> {
  return withTenant(tenantId, async (tx) => {
    const [d] = await tx<{
      dispatch_code: string; status: DispatchStatus; customer_name: string | null;
      destination: string | null; reference_number: string | null;
      agent_legal_name: string; warehouse_name: string | null; created_at: string;
    }[]>`
      SELECT sd.dispatch_code, sd.status, sd.customer_name, sd.destination, sd.reference_number,
             aa.legal_name AS agent_legal_name, w.name AS warehouse_name, sd.created_at
      FROM sales_dispatch sd
      JOIN agent_account aa ON aa.id = sd.agent_account_id
      LEFT JOIN warehouse w ON w.id = sd.warehouse_id
      WHERE sd.id = ${dispatchId} AND sd.tenant_id = ${tenantId}`;
    if (!d) return null;

    const items = await tx<{
      product_name: string; product_code: string; sku: string; grade: string | null;
      batch_number: string | null; shade_code: string | null; caliber_code: string | null;
      bin_location: string | null; quantity_boxes: number;
    }[]>`
      SELECT p.name AS product_name, p.code AS product_code, pv.sku, pv.grade,
             l.batch_number, l.shade_code, l.caliber_code, sdi.bin_location, sdi.quantity_boxes
      FROM sales_dispatch_item sdi
      JOIN product_variant pv ON pv.id = sdi.variant_id
      JOIN product p ON p.id = pv.product_id
      LEFT JOIN inventory_lot l ON l.id = sdi.lot_id
      WHERE sdi.dispatch_id = ${dispatchId} AND sdi.tenant_id = ${tenantId}
      ORDER BY p.code`;

    // جمعِ فاکتور: یک sales_request می‌تواند به چند حواله (یک به‌ازای هر انبار) تقسیم شده
    // باشد، پس unit_price_applied/discount_amount روی sales_request_item مالِ کلِ سفارش
    // است، نه فقط سهمِ همین حواله — تخفیف به‌نسبتِ تعدادِ همین حواله سهم‌بندی می‌شود.
    const priceRows = await tx<{
      variant_id: string; unit_price_applied: string | null; discount_amount: string | null;
      requested_qty_boxes: number; dispatch_qty: number;
    }[]>`
      SELECT sdi.variant_id, sri.unit_price_applied, sri.discount_amount, sri.requested_qty_boxes,
             SUM(sdi.quantity_boxes)::int AS dispatch_qty
      FROM sales_dispatch_item sdi
      JOIN sales_dispatch sd ON sd.id = sdi.dispatch_id
      JOIN sales_request_item sri ON sri.request_id = sd.sales_request_id
        AND sri.variant_id = sdi.variant_id AND sri.tenant_id = sdi.tenant_id
      WHERE sdi.dispatch_id = ${dispatchId} AND sdi.tenant_id = ${tenantId}
      GROUP BY sdi.variant_id, sri.unit_price_applied, sri.discount_amount, sri.requested_qty_boxes`;

    let totalValue = 0, anyPriced = false;
    for (const r of priceRows) {
      if (r.unit_price_applied == null) continue;
      anyPriced = true;
      const discountShare = Math.round(Number(r.discount_amount ?? 0) * r.dispatch_qty / r.requested_qty_boxes);
      totalValue += Number(r.unit_price_applied) * r.dispatch_qty - discountShare;
    }

    return {
      dispatchCode: d.dispatch_code, status: d.status, customerName: d.customer_name,
      destination: d.destination, referenceNumber: d.reference_number,
      agentLegalName: d.agent_legal_name, warehouseName: d.warehouse_name, createdAt: d.created_at,
      totalValue: anyPriced ? totalValue : null,
      items: items.map((i) => ({
        productName: i.product_name, productCode: i.product_code, sku: i.sku, grade: i.grade,
        batchNumber: i.batch_number, shadeCode: i.shade_code, caliberCode: i.caliber_code,
        binLocation: i.bin_location, quantityBoxes: i.quantity_boxes,
      })),
    };
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
  /** ندهید تا خودکار ساخته شود (BO-1404-001). */
  dispatchCode?: string; customerName?: string; destination?: string; customerId?: string;
  /** v10: شماره‌ی دفتر/مرجعِ داخلیِ پشتیبان — فقط ذخیره و روی چاپ نمایش داده می‌شود. */
  referenceNumber?: string | null;
  items: { variantId: string; quantityBoxes: number }[];
}): Promise<{ ok: true; dispatchId: string } | { ok: false; reason: "no_items" | "bad_qty" }> {
  const { tenantId, agentAccountId, createdByUserId, customerName, destination, items, customerId, referenceNumber } = params;
  if (items.length === 0) return { ok: false, reason: "no_items" };
  if (items.some((i) => !Number.isInteger(i.quantityBoxes) || i.quantityBoxes <= 0)) return { ok: false, reason: "bad_qty" };
  return withTenant(tenantId, async (tx) => {
    const dispatchCode = params.dispatchCode ?? await nextDispatchCode(tx, tenantId, "BO");
    const [d] = await tx<{ id: string }[]>`
      INSERT INTO sales_dispatch
        (tenant_id, sales_request_id, agent_account_id, dispatch_code, customer_name, customer_id,
         destination, reference_number, status, created_by_user_id)
      VALUES (${tenantId}, NULL, ${agentAccountId}, ${dispatchCode}, ${customerName ?? null}, ${norm(customerId)},
              ${norm(destination)}, ${norm(referenceNumber)}, 'registered', ${createdByUserId})
      RETURNING id`;
    for (const it of items)
      await tx`
        INSERT INTO sales_dispatch_item
          (tenant_id, dispatch_id, lot_id, fulfillment_type, backorder_status, variant_id, quantity_boxes)
        VALUES (${tenantId}, ${d.id}, NULL, 'backorder', 'pending_production', ${it.variantId}, ${it.quantityBoxes})`;
    return { ok: true, dispatchId: d.id };
  });
}

export type BackorderListItem = {
  id: string; status: BackorderStatus; qty: number; name: string; code: string;
  dispatchCode: string; agentName: string;
};

/** فهرستِ اقلامِ backorder، صفحه‌بندی‌شده + جستجو (کالا/کد/نمایندگی/کدِ حواله) — همان دلیلِ listDispatches. */
export async function listBackorderItems(p: {
  tenantId: string; q?: string; limit?: number; offset?: number;
}): Promise<{ items: BackorderListItem[]; hasMore: boolean }> {
  const limit = p.limit ?? 100, offset = p.offset ?? 0, q = p.q?.trim();
  const rows = await withTenant(p.tenantId, (tx) =>
    tx<BackorderListItem[]>`
      SELECT sdi.id, sdi.backorder_status AS status, sdi.quantity_boxes AS qty,
             p.name, p.code, sd.dispatch_code AS "dispatchCode", aa.legal_name AS "agentName"
      FROM sales_dispatch_item sdi
      JOIN sales_dispatch sd ON sd.id = sdi.dispatch_id
      JOIN agent_account aa ON aa.id = sd.agent_account_id
      JOIN product_variant pv ON pv.id = sdi.variant_id
      JOIN product p ON p.id = pv.product_id
      WHERE sdi.tenant_id = ${p.tenantId} AND sdi.fulfillment_type = 'backorder'
        AND ${q ? tx`(p.name ILIKE ${"%" + q + "%"} OR p.code ILIKE ${"%" + q + "%"} OR aa.legal_name ILIKE ${"%" + q + "%"} OR sd.dispatch_code ILIKE ${"%" + q + "%"})` : tx`TRUE`}
      ORDER BY sd.created_at DESC
      LIMIT ${limit + 1} OFFSET ${offset}`,
  );
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
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
