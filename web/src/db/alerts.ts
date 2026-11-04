import type { TransactionSql } from "postgres";
import { withTenant } from "./client";

/**
 * StockAlert — «وقتی موجود شد خبرم کن» (spec ۵.۹).
 * اشتراک یک‌بارمصرف است: به‌محض موجود شدن، پیام صف می‌شود و خودِ alert حذف می‌شود.
 * پس هر اشتراک حداکثر یک پیام می‌دهد و اسپم ممکن نیست — بدون نیاز به نگه‌داشتنِ
 * وضعیتِ «قبلاً ناموجود بود».
 */
export async function subscribeAlert(p: { tenantId: string; agentAccountId: string; variantId: string }) {
  await withTenant(p.tenantId, (tx) => tx`
    INSERT INTO stock_alert (tenant_id, agent_account_id, variant_id)
    VALUES (${p.tenantId}, ${p.agentAccountId}, ${p.variantId})
    ON CONFLICT (agent_account_id, variant_id) DO NOTHING`);
}

export async function unsubscribeAlert(p: { tenantId: string; agentAccountId: string; variantId: string }) {
  await withTenant(p.tenantId, (tx) => tx`
    DELETE FROM stock_alert
    WHERE tenant_id = ${p.tenantId} AND agent_account_id = ${p.agentAccountId} AND variant_id = ${p.variantId}`);
}

/** اشتراک‌های این نماینده + کالاهایی که الان ناموجودند (برای دکمه‌ی «خبرم کن»). */
export async function listAlertsAndOutOfStock(p: { tenantId: string; agentAccountId: string }) {
  return withTenant(p.tenantId, async (tx) => {
    const subscribed = await tx<{ variantId: string }[]>`
      SELECT variant_id AS "variantId" FROM stock_alert
      WHERE tenant_id = ${p.tenantId} AND agent_account_id = ${p.agentAccountId}`;
    // ناموجود = هیچ lotی با available > 0 ندارد (شاملِ variantهای بدون هیچ lot)
    const outOfStock = await tx<{ variantId: string; name: string; code: string }[]>`
      SELECT pv.id AS "variantId", p.name, p.code
      FROM product_variant pv
      JOIN product p ON p.id = pv.product_id
      WHERE pv.tenant_id = ${p.tenantId}
        AND NOT EXISTS (
          SELECT 1 FROM inventory_lot l
          JOIN v_lot_availability a ON a.lot_id = l.id
          WHERE l.variant_id = pv.id AND a.available_qty_boxes > 0
        )
      ORDER BY p.name`;
    return { subscribed: subscribed.map((s) => s.variantId), outOfStock };
  });
}

/**
 * صف‌کردنِ پیامِ «موجود شد» برای lotهایی که تازه موجودی گرفته‌اند.
 *
 * عمداً `tx` می‌گیرد نه اتصال جدا: الگوی Outbox یعنی پیام در **همان تراکنشی** صف شود
 * که تغییر وضعیت را انجام داده. اگر import رول‌بک شود، هیچ پیامی هم نمی‌ماند — نه
 * پیامِ دروغینِ «موجود شد» برای موجودی‌ای که هرگز ثبت نشد.
 * برمی‌گرداند: تعداد پیام‌های صف‌شده.
 */
export async function enqueueRestockNotifications(
  tx: TransactionSql, tenantId: string, touchedLotIds: string[],
): Promise<number> {
  if (touchedLotIds.length === 0) return 0;

  const variants = await tx<{ variant_id: string }[]>`
    SELECT DISTINCT l.variant_id
    FROM inventory_lot l
    JOIN v_lot_availability a ON a.lot_id = l.id
    WHERE l.tenant_id = ${tenantId} AND l.id IN ${tx(touchedLotIds)}
      AND a.available_qty_boxes > 0`;
  if (variants.length === 0) return 0;
  const variantIds = variants.map((v) => v.variant_id);

  // حذفِ alert و صف‌کردن پیام در یک دستور: alert یک‌بارمصرف است
  const queued = await tx<{ id: string }[]>`
    WITH fired AS (
      DELETE FROM stock_alert
      WHERE tenant_id = ${tenantId} AND variant_id IN ${tx(variantIds)}
      RETURNING agent_account_id, variant_id
    )
    INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
    SELECT ${tenantId}, 'sms', u.phone,
           jsonb_build_object('type', 'restock', 'variantId', f.variant_id,
                              'product', p.name, 'code', p.code)
    FROM fired f
    JOIN agent_account_user aau ON aau.agent_account_id = f.agent_account_id AND aau.tenant_id = ${tenantId}
    JOIN app_user u ON u.id = aau.user_id AND u.is_active
    JOIN product_variant pv ON pv.id = f.variant_id
    JOIN product p ON p.id = pv.product_id
    RETURNING id`;
  return queued.length;
}
