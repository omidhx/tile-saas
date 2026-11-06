import { withTenant } from "./client";

/**
 * گزارش‌های مدیریتی (v2، spec ۹: «عملکرد نماینده، کالای پرفروش/راکد»).
 * فقط خواندنی — هیچ چیزی را تغییر نمی‌دهد.
 *
 * یک تصمیمِ داده‌ای که باید صریح باشد: **`sales_dispatch_item` قیمت ندارد.**
 * قیمت فقط روی snapshotِ `sales_request_item` است. پس:
 *   • «ارزش ریالی» از سفارش‌های تأییدشده می‌آید (قیمتِ لحظه‌ی تأیید).
 *   • «کارتنِ بارگیری‌شده» از لجر می‌آید (حقیقتِ فیزیکی).
 * این دو عمداً جدا گزارش می‌شوند و با هم جمع نمی‌شوند: یکی تعهد است، دیگری تحویل.
 * قاطی‌کردنشان یک عددِ «درآمد» می‌سازد که هیچ‌کدام نیست — و حواله‌ی backorder اصلاً
 * قیمت ندارد، پس چنین عددی بی‌سروصدا کم‌شمار هم می‌شد.
 */

export type AgentPerf = {
  agentId: string; agentName: string; requests: number; boxes: number; value: number;
  /** خط‌هایی که قیمتِ ثبت‌شده ندارند. بدون این، «۰ ریال» با «قیمت ثبت نشده» یکی دیده می‌شود. */
  unpricedLines: number;
};
export type TopProduct = { name: string; code: string; boxes: number };
export type DeadStock = { name: string; code: string; onHand: number };
export type Reports = {
  from: string; to: string;
  agents: AgentPerf[];
  topProducts: TopProduct[];
  deadStock: DeadStock[];
};

export async function buildReports(p: {
  tenantId: string; from: Date; to: Date;
  /** فیلترِ اختیاریِ نماینده/کالا — همان بازه، محدود به یکی از این دو (یا هردو). */
  agentAccountId?: string | null; variantId?: string | null;
}): Promise<Reports> {
  const { tenantId, from, to, agentAccountId, variantId } = p;
  return withTenant(tenantId, async (tx) => {
    // عملکرد نماینده — ارزش از قیمتِ snapshot‌شده، نه قیمت امروز
    const agents = await tx<{ agentId: string; agentName: string; requests: number; boxes: number; value: string; unpricedLines: number }[]>`
      SELECT aa.id AS "agentId", aa.legal_name AS "agentName",
             count(DISTINCT sr.id)::int AS requests,
             COALESCE(SUM(sri.requested_qty_boxes - cx.qty), 0)::int AS boxes,
             COALESCE(SUM(sri.unit_price_applied * (sri.requested_qty_boxes - cx.qty)
                          - ROUND(COALESCE(sri.discount_amount, 0) * (sri.requested_qty_boxes - cx.qty)
                                  / NULLIF(sri.requested_qty_boxes, 0))), 0)::bigint AS value,
             count(*) FILTER (WHERE sri.id IS NOT NULL AND sri.unit_price_applied IS NULL)::int AS "unpricedLines"
      FROM sales_request sr
      JOIN agent_account aa ON aa.id = sr.agent_account_id AND aa.tenant_id = sr.tenant_id
      LEFT JOIN sales_request_item sri ON sri.request_id = sr.id AND sri.tenant_id = sr.tenant_id
      -- سهمِ لغوشده‌ی سفارشِ دوانباره (E3-F4): درخواست تأییدشده می‌ماند ولی حواله‌ی یک انبار
      -- لغو شده و تخصیصش آزاد شده؛ آن کارتن‌ها فروش نیستند. هر تخصیص دقیقاً یک قلمِ حواله است
      -- (همان lot)، پس کمِ تخصیص‌هایی که حواله‌شان لغو شده. تخفیف هم به همان نسبت، مثلِ برگه‌ی حواله.
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(sra.allocated_qty_boxes), 0)::int AS qty
        FROM sales_request_allocation sra
        WHERE sra.sales_request_item_id = sri.id AND sra.tenant_id = sr.tenant_id
          AND EXISTS (SELECT 1 FROM sales_dispatch_item sdi
                      JOIN sales_dispatch sd ON sd.id = sdi.dispatch_id AND sd.tenant_id = sdi.tenant_id
                      WHERE sd.tenant_id = sr.tenant_id AND sd.sales_request_id = sr.id
                        AND sd.status = 'cancelled' AND sdi.lot_id = sra.lot_id)
      ) cx ON TRUE
      WHERE sr.tenant_id = ${tenantId}
        AND sr.status IN ('approved', 'fulfilled')
        AND sr.created_at >= ${from} AND sr.created_at < ${to}
        AND ${agentAccountId ? tx`aa.id = ${agentAccountId}` : tx`TRUE`}
        AND ${variantId ? tx`sri.variant_id = ${variantId}` : tx`TRUE`}
      GROUP BY aa.id, aa.legal_name
      ORDER BY value DESC, boxes DESC`;

    // پرفروش‌ها — کارتنی که واقعاً بارگیری شد (لجر)، نه چیزی که سفارش داده شد.
    // فیلترِ نماینده از رویِ خودِ حواله می‌آید — لجر نماینده ندارد، حواله دارد.
    const topProducts = await tx<{ name: string; code: string; boxes: number }[]>`
      SELECT p.name, p.code, SUM(-t.on_hand_delta_boxes)::int AS boxes
      FROM inventory_transaction t
      JOIN inventory_lot l    ON l.id = t.lot_id
      JOIN product_variant pv ON pv.id = l.variant_id
      JOIN product p          ON p.id = pv.product_id
      LEFT JOIN sales_dispatch sd ON sd.tenant_id = t.tenant_id AND sd.id = t.reference_id AND t.reference_type = 'sales_dispatch'
      WHERE t.tenant_id = ${tenantId} AND t.transaction_type = 'dispatch_load'
        AND t.created_at >= ${from} AND t.created_at < ${to}
        AND ${agentAccountId ? tx`sd.agent_account_id = ${agentAccountId}` : tx`TRUE`}
        AND ${variantId ? tx`pv.id = ${variantId}` : tx`TRUE`}
      GROUP BY p.name, p.code
      ORDER BY boxes DESC
      LIMIT 20`;

    // راکدها — موجودی دارد ولی در این بازه هیچ بارگیری نداشته (سرمایه‌ی خوابیده).
    // فیلترِ نماینده اینجا بی‌معنی است (موجودی مالِ نماینده‌ی خاصی نیست)، فقط کالا اعمال می‌شود.
    const deadStock = await tx<{ name: string; code: string; onHand: number }[]>`
      SELECT p.name, p.code, SUM(b.on_hand_qty_boxes)::int AS "onHand"
      FROM inventory_lot l
      JOIN inventory_balance b ON b.lot_id = l.id
      JOIN product_variant pv  ON pv.id = l.variant_id
      JOIN product p           ON p.id = pv.product_id
      WHERE l.tenant_id = ${tenantId} AND b.on_hand_qty_boxes > 0
        AND ${variantId ? tx`pv.id = ${variantId}` : tx`TRUE`}
        AND NOT EXISTS (
          SELECT 1 FROM inventory_transaction t
          WHERE t.lot_id = l.id AND t.transaction_type = 'dispatch_load'
            AND t.created_at >= ${from} AND t.created_at < ${to}
        )
      GROUP BY p.name, p.code
      ORDER BY "onHand" DESC
      LIMIT 20`;

    return {
      from: from.toISOString(), to: to.toISOString(),
      // value به‌صورت bigint می‌آید (رشته). مبالغ ریالیِ این مقیاس خیلی زیر
      // MAX_SAFE_INTEGER‌اند، پس Number امن است.
      agents: agents.map((a) => ({ ...a, value: Number(a.value) })),
      topProducts, deadStock,
    };
  });
}
