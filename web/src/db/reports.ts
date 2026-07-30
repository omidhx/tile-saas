import { withTenant } from "./client";
import { toJalali, jalaliToDate, JALALI_MONTHS } from "@/lib/date";

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
/** discountAmount از `sales_request_item.discount_amount` (پله‌ی تخفیفِ حجمیِ لحظه‌ی تأیید) — نه استثنای نماینده که خودش قیمتِ دیگری است، نه «تخفیف» روی همان قیمت. */
export type DiscountByAgent = { agentId: string; agentName: string; discountedLines: number; discountAmount: number; grossAmount: number };
export type DiscountByProduct = { name: string; code: string; discountedLines: number; discountAmount: number };

export type Reports = {
  from: string; to: string;
  agents: AgentPerf[];
  topProducts: TopProduct[];
  deadStock: DeadStock[];
  discountsByAgent: DiscountByAgent[];
  discountsByProduct: DiscountByProduct[];
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
             COALESCE(SUM(sri.requested_qty_boxes), 0)::int AS boxes,
             COALESCE(SUM(sri.unit_price_applied * sri.requested_qty_boxes
                          - COALESCE(sri.discount_amount, 0)), 0)::bigint AS value,
             count(*) FILTER (WHERE sri.id IS NOT NULL AND sri.unit_price_applied IS NULL)::int AS "unpricedLines"
      FROM sales_request sr
      JOIN agent_account aa ON aa.id = sr.agent_account_id AND aa.tenant_id = sr.tenant_id
      LEFT JOIN sales_request_item sri ON sri.request_id = sr.id AND sri.tenant_id = sr.tenant_id
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

    // تخفیف‌های اعمال‌شده به‌تفکیکِ نماینده — discount_amount همان چیزی است که در
    // لحظه‌ی تأیید از پله‌ی تخفیفِ حجمی کم شده (spec ۵.۷)، مستقل از منبعِ قیمت
    // (لیست یا استثنای نماینده). HAVING فقط نماینده‌هایی را نشان می‌دهد که واقعاً
    // تخفیفی گرفته‌اند — وگرنه فهرست پر از صفر می‌شد.
    const discountsByAgent = await tx<{ agentId: string; agentName: string; discountedLines: number; discountAmount: string; grossAmount: string }[]>`
      SELECT aa.id AS "agentId", aa.legal_name AS "agentName",
             count(*) FILTER (WHERE sri.discount_amount > 0)::int AS "discountedLines",
             COALESCE(SUM(sri.discount_amount), 0)::bigint AS "discountAmount",
             COALESCE(SUM(sri.unit_price_applied * sri.requested_qty_boxes), 0)::bigint AS "grossAmount"
      FROM sales_request sr
      JOIN agent_account aa ON aa.id = sr.agent_account_id AND aa.tenant_id = sr.tenant_id
      JOIN sales_request_item sri ON sri.request_id = sr.id AND sri.tenant_id = sr.tenant_id
      WHERE sr.tenant_id = ${tenantId}
        AND sr.status IN ('approved', 'fulfilled')
        AND sr.created_at >= ${from} AND sr.created_at < ${to}
        AND ${agentAccountId ? tx`aa.id = ${agentAccountId}` : tx`TRUE`}
        AND ${variantId ? tx`sri.variant_id = ${variantId}` : tx`TRUE`}
      GROUP BY aa.id, aa.legal_name
      HAVING COALESCE(SUM(sri.discount_amount), 0) > 0
      ORDER BY "discountAmount" DESC`;

    // همان تخفیف، به‌تفکیکِ کالا — کدام کالا بیشترین تخفیف را در این بازه گرفته
    const discountsByProduct = await tx<{ name: string; code: string; discountedLines: number; discountAmount: string }[]>`
      SELECT p.name, p.code,
             count(*) FILTER (WHERE sri.discount_amount > 0)::int AS "discountedLines",
             COALESCE(SUM(sri.discount_amount), 0)::bigint AS "discountAmount"
      FROM sales_request sr
      JOIN sales_request_item sri ON sri.request_id = sr.id AND sri.tenant_id = sr.tenant_id
      JOIN product_variant pv ON pv.id = sri.variant_id
      JOIN product p ON p.id = pv.product_id
      WHERE sr.tenant_id = ${tenantId}
        AND sr.status IN ('approved', 'fulfilled')
        AND sr.created_at >= ${from} AND sr.created_at < ${to}
        AND ${agentAccountId ? tx`sr.agent_account_id = ${agentAccountId}` : tx`TRUE`}
        AND ${variantId ? tx`pv.id = ${variantId}` : tx`TRUE`}
      GROUP BY p.name, p.code
      HAVING COALESCE(SUM(sri.discount_amount), 0) > 0
      ORDER BY "discountAmount" DESC
      LIMIT 20`;

    return {
      from: from.toISOString(), to: to.toISOString(),
      // value به‌صورت bigint می‌آید (رشته). مبالغ ریالیِ این مقیاس خیلی زیر
      // MAX_SAFE_INTEGER‌اند، پس Number امن است.
      agents: agents.map((a) => ({ ...a, value: Number(a.value) })),
      topProducts, deadStock,
      discountsByAgent: discountsByAgent.map((d) => ({
        ...d, discountAmount: Number(d.discountAmount), grossAmount: Number(d.grossAmount),
      })),
      discountsByProduct: discountsByProduct.map((d) => ({ ...d, discountAmount: Number(d.discountAmount) })),
    };
  });
}

export type MonthlyBucket = { jy: number; jm: number; label: string };
export type AgentMonthlyRow = { agentId: string; agentName: string; months: { boxes: number; value: number }[] };
export type MonthlyAgentPerf = { buckets: MonthlyBucket[]; rows: AgentMonthlyRow[] };

/**
 * عملکردِ نماینده ماه‌به‌ماه (شمسی) — برایِ دیدنِ روند، نه یک بازه‌ی تکی.
 * چون ماه‌های شمسی روی تقویمِ میلادیِ Postgres منطبق نیستند (`date_trunc` کمکی
 * نمی‌کند)، سطرهای خام در یک کوئری گرفته می‌شوند و باکت‌بندیِ ماهانه در جاوااسکریپت
 * انجام می‌شود — با همان `toJalali`ای که کلِ سایت برایِ تقویمِ شمسی مرجع می‌داند.
 */
export async function buildMonthlyAgentPerf(p: { tenantId: string; months: number }): Promise<MonthlyAgentPerf> {
  const { tenantId } = p;
  // ۰ یا منفی یعنی «حداقل یک ماه»، نه «نامعتبر پس پیش‌فرض» — || شکستِ صفر را می‌گرفت
  const rawMonths = Math.trunc(p.months);
  const monthsCount = Number.isFinite(rawMonths) ? Math.min(Math.max(rawMonths, 1), 12) : 6; // ponytail: سقفِ منطقی، نه پرسشِ بی‌نهایتِ سال‌ها

  const todayJ = toJalali(new Date());
  const buckets: MonthlyBucket[] = [];
  for (let i = monthsCount - 1; i >= 0; i--) {
    let jy = todayJ.jy, jm = todayJ.jm - i;
    while (jm <= 0) { jm += 12; jy -= 1; }
    buckets.push({ jy, jm, label: `${JALALI_MONTHS[jm - 1]} ${jy.toLocaleString("fa-IR", { useGrouping: false })}` });
  }
  const from = jalaliToDate({ jy: buckets[0].jy, jm: buckets[0].jm, jd: 1 });

  return withTenant(tenantId, async (tx) => {
    const rows = await tx<{ agentId: string; agentName: string; createdAt: string; qty: number; unitPrice: string | null; discount: string | null }[]>`
      SELECT aa.id AS "agentId", aa.legal_name AS "agentName", sr.created_at AS "createdAt",
             sri.requested_qty_boxes AS qty, sri.unit_price_applied AS "unitPrice", sri.discount_amount AS discount
      FROM sales_request sr
      JOIN agent_account aa ON aa.id = sr.agent_account_id AND aa.tenant_id = sr.tenant_id
      JOIN sales_request_item sri ON sri.request_id = sr.id AND sri.tenant_id = sr.tenant_id
      WHERE sr.tenant_id = ${tenantId} AND sr.status IN ('approved', 'fulfilled')
        AND sr.created_at >= ${from}`;

    const byAgent = new Map<string, { name: string; cells: Map<string, { boxes: number; value: number }> }>();
    for (const r of rows) {
      const j = toJalali(new Date(r.createdAt));
      const key = `${j.jy}-${j.jm}`;
      let agent = byAgent.get(r.agentId);
      if (!agent) { agent = { name: r.agentName, cells: new Map() }; byAgent.set(r.agentId, agent); }
      const cell = agent.cells.get(key) ?? { boxes: 0, value: 0 };
      cell.boxes += r.qty;
      // خطِ بدون قیمت (unit_price_applied=NULL) به ارزش صفر اضافه نمی‌شود — «قیمت ثبت نشده» با «رایگان» یکی نیست
      if (r.unitPrice != null) cell.value += Number(r.unitPrice) * r.qty - Number(r.discount ?? 0);
      agent.cells.set(key, cell);
    }

    const outRows: AgentMonthlyRow[] = [...byAgent.entries()]
      .map(([agentId, a]) => ({
        agentId, agentName: a.name,
        months: buckets.map((b) => a.cells.get(`${b.jy}-${b.jm}`) ?? { boxes: 0, value: 0 }),
      }))
      // نمایندگیِ پرارزش‌تر (جمعِ کلِ بازه) بالاتر — همان ترتیبی که «عملکرد نمایندگان» دارد
      .sort((x, y) => y.months.reduce((s, m) => s + m.value, 0) - x.months.reduce((s, m) => s + m.value, 0));

    return { buckets, rows: outRows };
  });
}
