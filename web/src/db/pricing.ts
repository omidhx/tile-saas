import type { TransactionSql } from "postgres";
import { withTenant } from "./client";

/**
 * قیمت‌گذاری (v2، spec ۵.۷ + roadmap v2).
 *
 * ترتیبِ اولویت — مشخص‌ترین برنده است:
 *   ۱. `agent_price_override` معتبر در تاریخِ مرجع  → source='override'
 *   ۲. قلمِ لیستِ قیمتِ همان نماینده                 → source='list'
 *   ۳. هیچ                                          → قیمتی نداریم (null)
 * بعد، تخفیف حجمی بر اساس تعداد کارتن روی مبلغِ کل اعمال می‌شود.
 *
 * **همه‌چیز عددِ صحیح است** (کوچیک‌ترین واحد پولی، قانون معماری #۷): درصدِ تخفیف
 * هم INT است و با `Math.floor` حساب می‌شود، پس هیچ‌جا float وارد مسیر پول نمی‌شود.
 * spec: «متراژ و پول هیچ‌وقت float نیست؛ اعشار فقط در لایه‌ی UI».
 */

export type PriceSource = "override" | "list";

export type ResolvedPrice = {
  variantId: string;
  unitPrice: number;        // قیمت واحد (هر کارتن)، کوچیک‌ترین واحد پولی
  source: PriceSource;
  percentOff: number;       // ۰ اگر تخفیف حجمی نخورده
  lineTotal: number;        // unitPrice*qty منهای تخفیف — صحیح
  discountAmount: number;   // مبلغ تخفیف، صحیح
};

/** تخفیفِ کل خط: floor روی مبلغ، نه روی قیمت واحد (تا گِرد کردن به ضرر/نفع انباشته نشود). */
export function applyVolumeDiscount(unitPrice: number, qty: number, percentOff: number) {
  const gross = unitPrice * qty;
  const discountAmount = Math.floor((gross * percentOff) / 100);
  return { gross, discountAmount, lineTotal: gross - discountAmount };
}

/**
 * قیمتِ یک نماینده برای چند variant (بالک — صفحه‌ی کاتالوگ ده‌ها قلم دارد و
 * کوئری‌به‌ازای‌قلم همان N+1ای است که در import هم حذفش کردیم).
 * `qty` برای محاسبه‌ی پله‌ی تخفیف؛ برای نمایشِ کاتالوگ ۱ بفرست.
 */
export async function resolvePrices(params: {
  tenantId: string; agentAccountId: string; variantIds: string[];
  qtyByVariant?: Record<string, number>; at?: Date;
}): Promise<Map<string, ResolvedPrice>> {
  const { tenantId, agentAccountId, variantIds } = params;
  if (variantIds.length === 0) return new Map();
  return withTenant(tenantId, (tx) =>
    resolvePricesIn(tx, { ...params, variantIds }));
}

/** همان منطق، ولی داخل تراکنشِ فراخوان — برای snapshot گرفتن هنگام تأیید سفارش. */
export async function resolvePricesIn(
  tx: TransactionSql,
  params: {
    tenantId: string; agentAccountId: string; variantIds: string[];
    qtyByVariant?: Record<string, number>; at?: Date;
  },
): Promise<Map<string, ResolvedPrice>> {
  const { tenantId, agentAccountId, variantIds, qtyByVariant = {}, at } = params;
  if (variantIds.length === 0) return new Map();
  const asOf = at ?? new Date();

  // قیمتِ پایه: override بر لیست ارجح است. یک کوئری، نه یکی به‌ازای هر قلم.
  const rows = await tx<{ variant_id: string; price: string; source: PriceSource }[]>`
    SELECT DISTINCT ON (variant_id) variant_id, price, source FROM (
      SELECT o.variant_id, o.price, 'override'::text AS source, 1 AS rank
      FROM agent_price_override o
      WHERE o.tenant_id = ${tenantId} AND o.agent_account_id = ${agentAccountId}
        AND o.variant_id IN ${tx(variantIds)}
        AND (o.valid_from IS NULL OR o.valid_from <= ${asOf})
        AND (o.valid_to   IS NULL OR o.valid_to   >= ${asOf})
      UNION ALL
      SELECT pli.variant_id, pli.price, 'list'::text AS source, 2 AS rank
      FROM price_list_item pli
      JOIN agent_account aa ON aa.price_list_id = pli.price_list_id AND aa.tenant_id = pli.tenant_id
      WHERE pli.tenant_id = ${tenantId} AND aa.id = ${agentAccountId}
        AND pli.variant_id IN ${tx(variantIds)}
    ) candidates
    ORDER BY variant_id, rank`;

  // پله‌های تخفیف حجمی: بهترین (بیشترین درصدِ) پله‌ای که حداقلش برآورده شده.
  const tiers = await tx<{ variant_id: string | null; min_qty_boxes: number; percent_off: number }[]>`
    SELECT vd.variant_id, vd.min_qty_boxes, vd.percent_off
    FROM volume_discount vd
    LEFT JOIN agent_account aa ON aa.id = ${agentAccountId} AND aa.tenant_id = ${tenantId}
    WHERE vd.tenant_id = ${tenantId}
      AND (vd.variant_id IS NULL OR vd.variant_id IN ${tx(variantIds)})
      AND (vd.price_list_id IS NULL OR vd.price_list_id = aa.price_list_id)`;

  const out = new Map<string, ResolvedPrice>();
  for (const r of rows) {
    const unitPrice = Number(r.price);
    const qty = qtyByVariant[r.variant_id] ?? 1;
    // مخصوصِ همین کالا بر «همه‌ی کالاها» ارجح نیست — بیشترین درصدِ واجدشرایط برنده است
    const percentOff = tiers
      .filter((t) => (t.variant_id === null || t.variant_id === r.variant_id) && qty >= t.min_qty_boxes)
      .reduce((best, t) => Math.max(best, t.percent_off), 0);
    const { discountAmount, lineTotal } = applyVolumeDiscount(unitPrice, qty, percentOff);
    out.set(r.variant_id, { variantId: r.variant_id, unitPrice, source: r.source, percentOff, discountAmount, lineTotal });
  }
  return out;
}
