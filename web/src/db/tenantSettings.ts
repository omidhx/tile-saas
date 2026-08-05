import { withTenant } from "./client";
import { writeAudit, type AuditValue } from "./audit";

export type TenantSettings = { ttlHours: number; logoUrl: string | null };

/** تنظیماتِ کارخانه — TTLِ پیش‌فرضِ رزرو + لوگوی کاتالوگِ عمومی. */
export async function getTenantSettings(tenantId: string): Promise<TenantSettings | null> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx<{ ttlHours: number; logoUrl: string | null }[]>`
      SELECT default_reservation_ttl_hours AS "ttlHours", logo_url AS "logoUrl"
      FROM tenant WHERE id = ${tenantId}`;
    return row ?? null;
  });
}

/**
 * ویرایشِ تنظیماتِ کارخانه، با ردپا در دفترِ تغییرات — همان الگوی product.edit:
 * مقدارِ قبلی در همان تراکنش خوانده می‌شود، فقط فیلدهایی که واقعاً عوض شده‌اند ثبت می‌شوند.
 */
export async function updateTenantSettings(p: {
  tenantId: string; actorUserId: string; ttlHours?: number; logoUrl?: string | null;
}) {
  await withTenant(p.tenantId, async (tx) => {
    const [before] = await tx<{ ttlHours: number; logoUrl: string | null }[]>`
      SELECT default_reservation_ttl_hours AS "ttlHours", logo_url AS "logoUrl"
      FROM tenant WHERE id = ${p.tenantId}`;
    if (!before) return;

    await tx`
      UPDATE tenant SET
        default_reservation_ttl_hours = COALESCE(${p.ttlHours ?? null}, default_reservation_ttl_hours),
        logo_url = ${p.logoUrl === undefined ? tx`logo_url` : p.logoUrl}
      WHERE id = ${p.tenantId}`;

    const newTtl = p.ttlHours ?? before.ttlHours;
    const newLogo = p.logoUrl === undefined ? before.logoUrl : p.logoUrl;

    const oldDiff: Record<string, AuditValue> = {}, newDiff: Record<string, AuditValue> = {};
    const track = (key: string, oldVal: AuditValue, newVal: AuditValue) => {
      if (oldVal !== newVal) { oldDiff[key] = oldVal; newDiff[key] = newVal; }
    };
    track("ttlHours", before.ttlHours, newTtl);
    track("logoUrl", before.logoUrl, newLogo);

    if (Object.keys(newDiff).length)
      await writeAudit(tx, {
        tenantId: p.tenantId, actorUserId: p.actorUserId, action: "tenant_settings.edit",
        entity: "tenant", entityId: p.tenantId, oldValue: oldDiff, newValue: newDiff,
      });
  });
}
