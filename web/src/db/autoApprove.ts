import type { TransactionSql } from "postgres";
import { resolvePricesIn } from "./pricing";

/**
 * تأیید هیبریدی (v2، spec ۹: «approval mode هیبریدی — سقف رزرو → نیاز به تایید»).
 *
 * سفارشِ کوچک وقتِ روزانه‌ی پشتیبان را می‌خورد بدون اینکه تصمیمی در آن باشد؛
 * سفارشِ بزرگ باید نگاهِ انسان ببیند. این ماژول فقط **تصمیم** می‌گیرد — خودِ تأیید
 * کارِ `approveReservationIn` است.
 *
 * سقف:
 *   `agent_account.auto_approve_limit`  (NULL → ارث)  ← مشخص‌تر، برنده
 *   `tenant.auto_approve_limit`         (NULL → خاموش)
 * مقدارِ ۰ روی نماینده یعنی «هرگز خودکار» — چون هر سفارشی بزرگ‌تر از ۰ است.
 *
 * **همه‌ی مسیرهای ابهام به تأییدِ دستی می‌روند، نه به تأییدِ خودکار.** سقفِ تعریف‌نشده،
 * قیمتِ ثبت‌نشده، یا خطِ بی‌قیمت → دستی. تأییدِ خودکارِ اشتباه پول را متعهد می‌کند و
 * برگرداندنش کارِ آدم است؛ تأییدِ دستیِ اضافه فقط چند ثانیه وقت می‌گیرد.
 */

export type AutoApproveDecision =
  | { approve: true; limitApplied: number; orderValue: number }
  | { approve: false; reason: "disabled" | "over_limit" | "unpriced"; limit?: number; orderValue?: number };

export async function decideAutoApproval(
  tx: TransactionSql,
  p: { tenantId: string; agentAccountId: string; reservationId: string },
): Promise<AutoApproveDecision> {
  const { tenantId, agentAccountId, reservationId } = p;

  // سقفِ مؤثر: نماینده بر کارخانه ارجح. COALESCE دقیقاً همین را می‌گوید، چون
  // NULLِ نماینده یعنی «حرفی ندارم» و ۰ یعنی «هرگز» (و ۰ از COALESCE رد می‌شود).
  const [limitRow] = await tx<{ limit: string | null }[]>`
    SELECT COALESCE(aa.auto_approve_limit, t.auto_approve_limit) AS limit
    FROM agent_account aa
    JOIN tenant t ON t.id = aa.tenant_id
    WHERE aa.id = ${agentAccountId} AND aa.tenant_id = ${tenantId}`;
  if (!limitRow || limitRow.limit === null) return { approve: false, reason: "disabled" };
  const limit = Number(limitRow.limit);

  // تعدادِ هر variant در این رزرو (چند lot از یک variant با هم جمع می‌شوند —
  // پله‌ی تخفیف حجمی روی جمعِ کل می‌خورد، مثل خودِ تأیید).
  const items = await tx<{ variant_id: string; qty: number }[]>`
    SELECT l.variant_id, SUM(ri.quantity_boxes)::int AS qty
    FROM reservation_item ri
    JOIN inventory_lot l ON l.id = ri.lot_id
    WHERE ri.reservation_id = ${reservationId} AND ri.tenant_id = ${tenantId}
    GROUP BY l.variant_id`;
  if (items.length === 0) return { approve: false, reason: "unpriced" };

  const qtyByVariant = Object.fromEntries(items.map((i) => [i.variant_id, i.qty]));
  const prices = await resolvePricesIn(tx, {
    tenantId, agentAccountId,
    variantIds: items.map((i) => i.variant_id),
    qtyByVariant,
  });

  // اگر حتی یک خط قیمت نداشته باشد، ارزشِ سفارش را نمی‌دانیم. جمعِ ناقص را با سقف
  // مقایسه کردن یعنی سفارشِ گران را به‌خاطرِ قیمتِ گمشده خودکار تأیید کنیم.
  let orderValue = 0;
  for (const it of items) {
    const price = prices.get(it.variant_id);
    if (!price) return { approve: false, reason: "unpriced" };
    orderValue += price.lineTotal;
  }

  return orderValue <= limit
    ? { approve: true, limitApplied: limit, orderValue }
    : { approve: false, reason: "over_limit", limit, orderValue };
}
