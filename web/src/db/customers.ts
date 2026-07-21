import { withTenant } from "./client";

/**
 * مشتریِ نهایی به‌عنوان Entity (v2، spec ۹ — مشروط به ۷.۷).
 *
 * در MVP عمداً متن آزاد بود. دلیلِ ارتقا همان چیزی است که spec گفته بود:
 * **گزارشِ پرخریدترین مشتری**. پس این ماژول دو کار می‌کند و نه بیشتر:
 * نگه‌داشتنِ مشتری‌ها، و تاریخچه‌ی خریدشان.
 *
 * دو قاعده که از کارهای قبلی می‌آیند:
 *   • `sales_dispatch.customer_name` **snapshot** می‌ماند. اصلاحِ نامِ مشتری
 *     نباید حواله‌ی صادرشده را بازنویسی کند — همان قاعده‌ی snapshotِ قیمت.
 *   • «ارزش» از snapshotِ سفارش می‌آید و «کارتن» از لجرِ بارگیری. با هم جمع
 *     نمی‌شوند: یکی تعهد است، دیگری تحویل. (حواله‌ی backorder اصلاً سفارش ندارد،
 *     پس ارزشش نامعلوم است — و این صریح گزارش می‌شود، نه صفر.)
 */

export type Customer = {
  id: string; name: string; phone: string | null; note: string | null;
  agentAccountId: string | null; agentName: string | null; isActive: boolean;
};

export async function listCustomers(p: { tenantId: string; agentAccountId?: string }) {
  return withTenant(p.tenantId, (tx) => tx<Customer[]>`
    SELECT c.id, c.name, c.phone, c.note,
           c.agent_account_id AS "agentAccountId", aa.legal_name AS "agentName",
           c.is_active AS "isActive"
    FROM customer c
    LEFT JOIN agent_account aa ON aa.id = c.agent_account_id
    WHERE c.tenant_id = ${p.tenantId}
      -- نماینده فقط مشتریانِ خودش را می‌بیند؛ staff همه را
      AND ${p.agentAccountId ? tx`c.agent_account_id = ${p.agentAccountId}` : tx`TRUE`}
    ORDER BY c.is_active DESC, c.name`);
}

export async function addCustomer(p: {
  tenantId: string; name: string; phone?: string | null;
  note?: string | null; agentAccountId?: string | null;
}) {
  if (!p.name.trim()) throw new Error("نام مشتری لازم است");
  const [row] = await withTenant(p.tenantId, (tx) => tx<{ id: string }[]>`
    INSERT INTO customer (tenant_id, agent_account_id, name, phone, note)
    VALUES (${p.tenantId}, ${p.agentAccountId ?? null}, ${p.name.trim()},
            ${p.phone?.trim() || null}, ${p.note?.trim() || null})
    RETURNING id`);
  return row.id;
}

export async function updateCustomer(p: {
  tenantId: string; id: string; name?: string; phone?: string | null;
  note?: string | null; isActive?: boolean;
}) {
  await withTenant(p.tenantId, (tx) => tx`
    UPDATE customer SET
      name      = COALESCE(${p.name?.trim() ?? null}, name),
      phone     = ${p.phone === undefined ? tx`phone` : tx`${p.phone?.trim() || null}`},
      note      = ${p.note === undefined ? tx`note` : tx`${p.note?.trim() || null}`},
      is_active = COALESCE(${p.isActive ?? null}, is_active)
    WHERE tenant_id = ${p.tenantId} AND id = ${p.id}`);
}

export type CustomerSales = {
  customerId: string | null;
  /** برای حواله‌های قدیمیِ بدونِ Entity، نامِ متنِ آزاد. */
  name: string;
  dispatches: number;
  boxes: number;
  value: number;
  /** حواله‌هایی که ارزششان معلوم نیست (backorder یا سفارشِ بی‌قیمت). */
  unknownValueDispatches: number;
  linked: boolean;
};

/**
 * پرخریدترین مشتری‌ها — همان گزارشی که spec ارتقا به Entity را مشروط به آن کرده بود.
 *
 * حواله‌های قدیمی که `customer_id` ندارند حذف نمی‌شوند: زیر نامِ متنِ آزادشان و با
 * `linked: false` می‌آیند. حذفشان یعنی گزارش بی‌سروصدا کمتر از واقعیت نشان دهد.
 */
export async function customerSales(p: { tenantId: string; from: Date; to: Date }): Promise<CustomerSales[]> {
  return withTenant(p.tenantId, async (tx) => {
    const rows = await tx<{
      customerId: string | null; name: string; dispatches: number;
      boxes: number; value: string; unknownValueDispatches: number;
    }[]>`
      WITH d AS (
        SELECT sd.id, sd.customer_id,
               COALESCE(c.name, sd.customer_name, 'بدون نام') AS name,
               -- کارتنِ واقعاً بارگیری‌شده، از لجر (حقیقتِ فیزیکی)
               COALESCE((
                 SELECT SUM(-t.on_hand_delta_boxes)::int
                 FROM inventory_transaction t
                 WHERE t.reference_type = 'sales_dispatch' AND t.reference_id = sd.id
                   AND t.transaction_type = 'dispatch_load'
               ), 0) AS boxes,
               -- ارزش از snapshotِ سفارش. حواله‌ی backorder سفارش ندارد → NULL
               (
                 SELECT SUM(sri.unit_price_applied * sri.requested_qty_boxes
                            - COALESCE(sri.discount_amount, 0))
                 FROM sales_request_item sri
                 WHERE sri.request_id = sd.sales_request_id
                   AND sri.unit_price_applied IS NOT NULL
               ) AS value
        FROM sales_dispatch sd
        LEFT JOIN customer c ON c.id = sd.customer_id
        WHERE sd.tenant_id = ${p.tenantId}
          AND sd.created_at >= ${p.from} AND sd.created_at < ${p.to}
          AND sd.status <> 'cancelled'
      )
      SELECT d.customer_id AS "customerId", d.name,
             count(*)::int AS dispatches,
             COALESCE(SUM(d.boxes), 0)::int AS boxes,
             COALESCE(SUM(d.value), 0)::bigint AS value,
             count(*) FILTER (WHERE d.value IS NULL)::int AS "unknownValueDispatches"
      FROM d
      GROUP BY d.customer_id, d.name
      ORDER BY value DESC, boxes DESC`;

    return rows.map((r) => ({
      ...r, value: Number(r.value), linked: r.customerId !== null,
    }));
  });
}

/** تاریخچه‌ی یک مشتری — حواله‌هایش، تازه‌ترین اول. */
export async function customerHistory(p: { tenantId: string; customerId: string }) {
  return withTenant(p.tenantId, (tx) => tx<{
    dispatchId: string; dispatchCode: string; status: string; createdAt: string;
    agentName: string; warehouseName: string | null; boxes: number;
  }[]>`
    SELECT sd.id AS "dispatchId", sd.dispatch_code AS "dispatchCode", sd.status,
           sd.created_at AS "createdAt", aa.legal_name AS "agentName",
           w.name AS "warehouseName",
           COALESCE((
             SELECT SUM(-t.on_hand_delta_boxes)::int
             FROM inventory_transaction t
             WHERE t.reference_type = 'sales_dispatch' AND t.reference_id = sd.id
               AND t.transaction_type = 'dispatch_load'
           ), 0) AS boxes
    FROM sales_dispatch sd
    JOIN agent_account aa ON aa.id = sd.agent_account_id
    LEFT JOIN warehouse w ON w.id = sd.warehouse_id
    WHERE sd.tenant_id = ${p.tenantId} AND sd.customer_id = ${p.customerId}
    ORDER BY sd.created_at DESC
    LIMIT 100`);
}
