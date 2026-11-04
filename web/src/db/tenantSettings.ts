import { withTenant } from "./client";
import { writeAudit, type AuditValue } from "./audit";
import type { CurrencyUnit } from "@/lib/money";

export type TenantSettings = { ttlHours: number; logoUrl: string | null; currencyUnit: CurrencyUnit };

/** تنظیماتِ کارخانه — TTLِ پیش‌فرضِ رزرو + لوگوی کاتالوگِ عمومی + واحدِ نمایشِ مبلغ. */
export async function getTenantSettings(tenantId: string): Promise<TenantSettings | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx<TenantSettings[]>`
      SELECT default_reservation_ttl_hours AS "ttlHours", logo_url AS "logoUrl", currency_unit AS "currencyUnit"
      FROM tenant WHERE id = ${tenantId}`;
    return row ?? null;
  });
}

/**
 * ویرایشِ تنظیماتِ کارخانه، با ردپا در دفترِ تغییرات — همان الگوی product.edit:
 * مقدارِ قبلی در همان تراکنش خوانده می‌شود، فقط فیلدهایی که واقعاً عوض شده‌اند ثبت می‌شوند.
 */
export async function updateTenantSettings(p: {
  tenantId: string; actorUserId: string; ttlHours?: number; logoUrl?: string | null; currencyUnit?: CurrencyUnit;
}) {
  await withTenant(p.tenantId, async (tx) => {
    const [before] = await tx<TenantSettings[]>`
      SELECT default_reservation_ttl_hours AS "ttlHours", logo_url AS "logoUrl", currency_unit AS "currencyUnit"
      FROM tenant WHERE id = ${p.tenantId}`;
    if (!before) return;

    await tx`
      UPDATE tenant SET
        default_reservation_ttl_hours = COALESCE(${p.ttlHours ?? null}, default_reservation_ttl_hours),
        logo_url = ${p.logoUrl === undefined ? tx`logo_url` : p.logoUrl},
        currency_unit = COALESCE(${p.currencyUnit ?? null}, currency_unit)
      WHERE id = ${p.tenantId}`;

    const newTtl = p.ttlHours ?? before.ttlHours;
    const newLogo = p.logoUrl === undefined ? before.logoUrl : p.logoUrl;
    const newCurrency = p.currencyUnit ?? before.currencyUnit;

    const oldDiff: Record<string, AuditValue> = {}, newDiff: Record<string, AuditValue> = {};
    const track = (key: string, oldVal: AuditValue, newVal: AuditValue) => {
      if (oldVal !== newVal) { oldDiff[key] = oldVal; newDiff[key] = newVal; }
    };
    track("ttlHours", before.ttlHours, newTtl);
    track("logoUrl", before.logoUrl, newLogo);
    track("currencyUnit", before.currencyUnit, newCurrency);

    if (Object.keys(newDiff).length)
      await writeAudit(tx, {
        tenantId: p.tenantId, actorUserId: p.actorUserId, action: "tenant_settings.edit",
        entity: "tenant", entityId: p.tenantId, oldValue: oldDiff, newValue: newDiff,
      });
  });
}
