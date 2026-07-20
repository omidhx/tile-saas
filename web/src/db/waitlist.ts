import type { TransactionSql } from "postgres";
import { withTenant } from "./client";
import { reserveIn } from "./reservations";

/**
 * صف انتظار (v2، spec ۹: «صف انتظار برای رزروهای آزادشده»).
 *
 * چرا جدا از `stock_alert`: آن «خبرم کن» است و به همه پخش می‌شود — هرکس زودتر کلیک
 * کرد برنده، که وقتی موجودیِ آزادشده کم است یعنی نماینده‌ای که سه روز منتظر بوده به
 * کسی می‌بازد که اتفاقی صفحه‌اش باز بوده. این یک **صفِ منصفانه** است: به‌ترتیبِ نوبت،
 * برای نفرِ اولِ صف رزرو ساخته می‌شود.
 *
 * نکته‌ی کلیدیِ درستی: `held` فقط رزروِ `active` و منقضی‌نشده را می‌شمارد، پس موجودی
 * در **همان لحظه‌ی** لغو/انقضا آزاد می‌شود. بنابراین `advanceWaitlist` باید در همان
 * تراکنشِ آزادسازی اجرا شود، وگرنه پنجره‌ای می‌ماند که صف را بی‌معنا می‌کند.
 *
 * ponytail: پیشنهاد یک رزروِ معمولی با TTLِ خودِ کارخانه است — نه ماشینِ حالتِ تازه.
 * انقضا، آزادسازی، و لجرش همه از قبل کار می‌کنند. اگر TTLِ عادی برای پیشنهاد زیادی
 * بلند بود، `waitlist_claim_hours` جداگانه اضافه می‌شود.
 */

export type WaitlistOffer = {
  agentAccountId: string;
  variantId: string;
  reservationId: string;
  quantityBoxes: number;
};

export async function joinWaitlist(p: {
  tenantId: string; agentAccountId: string; variantId: string; quantityBoxes: number;
}) {
  if (!Number.isInteger(p.quantityBoxes) || p.quantityBoxes <= 0)
    throw new Error("تعداد باید عدد صحیح مثبت باشه");
  await withTenant(p.tenantId, (tx) => tx`
    INSERT INTO waitlist_entry (tenant_id, agent_account_id, variant_id, quantity_boxes)
    VALUES (${p.tenantId}, ${p.agentAccountId}, ${p.variantId}, ${p.quantityBoxes})
    -- درخواستِ دوباره فقط تعداد را به‌روز می‌کند و created_at را **دست نمی‌زند**:
    -- وگرنه با چند بار کلیک می‌شد نوبتِ خود را جلو انداخت.
    ON CONFLICT (agent_account_id, variant_id)
    DO UPDATE SET quantity_boxes = EXCLUDED.quantity_boxes`);
}

export async function leaveWaitlist(p: { tenantId: string; agentAccountId: string; variantId: string }) {
  await withTenant(p.tenantId, (tx) => tx`
    DELETE FROM waitlist_entry
    WHERE tenant_id = ${p.tenantId} AND agent_account_id = ${p.agentAccountId} AND variant_id = ${p.variantId}`);
}

/** نوبت‌های این نماینده، با جایگاهش در صف (۱ = نفر بعدی). */
export async function listMyWaitlist(p: { tenantId: string; agentAccountId: string }) {
  return withTenant(p.tenantId, (tx) => tx<
    { variantId: string; name: string; code: string; quantityBoxes: number; position: number }[]
  >`
    SELECT w.variant_id AS "variantId", p.name, p.code,
           w.quantity_boxes AS "quantityBoxes",
           (SELECT count(*) FROM waitlist_entry w2
             WHERE w2.tenant_id = w.tenant_id AND w2.variant_id = w.variant_id
               AND w2.created_at <= w.created_at)::int AS position
    FROM waitlist_entry w
    JOIN product_variant pv ON pv.id = w.variant_id
    JOIN product p ON p.id = pv.product_id
    WHERE w.tenant_id = ${p.tenantId} AND w.agent_account_id = ${p.agentAccountId}
    ORDER BY p.name`);
}

/**
 * صف را برای این variantها جلو می‌برد: تا وقتی موجودیِ آزاد کفافِ نفرِ اولِ صف را
 * می‌دهد، برایش رزرو می‌سازد و نوبتش را برمی‌دارد.
 *
 * **باید داخلِ تراکنشی صدا زده شود که موجودی را آزاد کرده** (لغو/انقضا/ورود موجودی).
 *
 * نوبت وقتی پیشنهاد ساخته شد حذف می‌شود، نه وقتی نماینده تأیید کرد: هر نوبت یک
 * پیشنهاد. اگر نماینده اقدام نکند رزرو منقضی می‌شود، موجودی دوباره آزاد می‌شود و
 * همین تابع نفرِ بعدی را صدا می‌زند — بدونِ ماشینِ حالتِ «پیشنهادشده/رد شده».
 */
export async function advanceWaitlist(
  tx: TransactionSql, tenantId: string, variantIds: string[],
): Promise<WaitlistOffer[]> {
  if (variantIds.length === 0) return [];

  const [tenant] = await tx<{ ttl: number }[]>`
    SELECT default_reservation_ttl_hours AS ttl FROM tenant WHERE id = ${tenantId}`;
  if (!tenant) return [];

  const offers: WaitlistOffer[] = [];

  for (const variantId of variantIds) {
    // صفِ این کالا به ترتیبِ نوبت. FOR UPDATE تا دو آزادسازیِ هم‌زمان یک نوبت را
    // دوبار پیشنهاد ندهند.
    const queue = await tx<{ id: string; agent_account_id: string; quantity_boxes: number }[]>`
      SELECT id, agent_account_id, quantity_boxes FROM waitlist_entry
      WHERE tenant_id = ${tenantId} AND variant_id = ${variantId}
      ORDER BY created_at
      FOR UPDATE`;

    for (const entry of queue) {
      // lotهای موجودِ این کالا با موجودیِ قابل‌سفارش، قدیمی‌ترین اول (FIFO انبار)
      const lots = await tx<{ lot_id: string; available: number }[]>`
        SELECT a.lot_id, a.available_qty_boxes AS available
        FROM v_lot_availability a
        JOIN inventory_lot l ON l.id = a.lot_id
        WHERE l.tenant_id = ${tenantId} AND l.variant_id = ${variantId}
          AND a.available_qty_boxes > 0
        ORDER BY l.entry_date, a.lot_id`;

      // all-or-nothing مثل خودِ رزرو (#۳): نوبت را با نصفِ سفارش نمی‌سوزانیم.
      const total = lots.reduce((s, l) => s + l.available, 0);
      if (total < entry.quantity_boxes) break; // این نفر جا نشد → بقیه‌ی صف هم منتظر می‌مانند

      let remaining = entry.quantity_boxes;
      const items = [];
      for (const l of lots) {
        if (remaining === 0) break;
        const take = Math.min(remaining, l.available);
        items.push({ lotId: l.lot_id, quantityBoxes: take });
        remaining -= take;
      }

      const r = await reserveIn(tx, {
        tenantId, agentAccountId: entry.agent_account_id,
        ttlHours: tenant.ttl,
        idempotencyKey: `waitlist:${entry.id}`,
        items,
        skipAutoApprove: true,
      });
      // conflict نباید بیفتد (همین حالا available را خواندیم و تراکنش قفل دارد)،
      // ولی اگر افتاد، نوبت را نمی‌سوزانیم و صف را همان‌جا متوقف می‌کنیم.
      if (!r.ok) break;

      await tx`DELETE FROM waitlist_entry WHERE id = ${entry.id}`;

      await tx`
        INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
        SELECT ${tenantId}::uuid, 'sms', u.phone,
               -- castها لازم‌اند: postgres نوعِ پارامتر داخل jsonb_build_object را
               -- از روی متن حدس نمی‌زند (۴۲P18).
               jsonb_build_object('type', 'waitlist_offer', 'variantId', ${variantId}::uuid,
                                  'product', p.name, 'code', p.code,
                                  'qty', ${entry.quantity_boxes}::int, 'ttlHours', ${tenant.ttl}::int)
        FROM agent_account_user aau
        JOIN app_user u ON u.id = aau.user_id AND u.is_active
        JOIN product_variant pv ON pv.id = ${variantId}::uuid
        JOIN product p ON p.id = pv.product_id
        WHERE aau.agent_account_id = ${entry.agent_account_id}::uuid AND aau.tenant_id = ${tenantId}::uuid`;

      offers.push({
        agentAccountId: entry.agent_account_id, variantId,
        reservationId: r.reservationId, quantityBoxes: entry.quantity_boxes,
      });
    }
  }

  return offers;
}
