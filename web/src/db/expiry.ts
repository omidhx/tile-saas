import { sql, withTenant } from "./client";
import { advanceWaitlist } from "./waitlist";

/**
 * بوک‌کیپینگِ انقضا: رزروهای از مهلت گذشته را active→expired می‌کند.
 * cross-tenant است (نگهداری)، پس withTenant ندارد — تابعِ SECURITY DEFINER از RLS عبور می‌کند.
 *
 * مهم: درستیِ available به این وابسته **نیست**. held همیشه شرطِ `expires_at > now()` را
 * دارد، پس رزروِ منقضی حتی قبل از اجرای این هم موجودی را آزاد کرده. این فقط لیست‌ها/گزارش‌ها
 * را مرتب می‌کند؛ اگر یک اجرا جا بیفتد هیچ عددی غلط نمی‌شود.
 *
 * ولی **صف انتظار** به آن وابسته است: موجودی از لحظه‌ی `expires_at` آزاد است و تا اجرای
 * بعدیِ این worker کسی در صف خبردار نمی‌شود. یعنی پنجره‌ای به اندازه‌ی فاصله‌ی cron
 * (۱۰–۱۵ دقیقه) هست که رهگذری می‌تواند موجودی را قبل از نفرِ اولِ صف بردارد.
 * ponytail: پذیرفته‌ایم — بستنش یعنی صف را در مسیرِ داغِ خواندنِ available هم چک کنیم.
 * اگر در عمل آزار داد، فاصله‌ی cron را کم کنید. (لغو این مشکل را ندارد: همان تراکنش.)
 */
export async function expireDueReservations(): Promise<{ expired: number; offers: number }> {
  // تابع حالا (tenant, variant)های آزادشده را برمی‌گرداند، نه فقط یک شمارش
  const freed = await sql<{ tenant_id: string; variant_id: string }[]>`
    SELECT * FROM expire_due_reservations()`;
  if (freed.length === 0) return { expired: 0, offers: 0 };

  const byTenant = new Map<string, string[]>();
  for (const f of freed) {
    const list = byTenant.get(f.tenant_id) ?? [];
    list.push(f.variant_id);
    byTenant.set(f.tenant_id, list);
  }

  // هر tenant تراکنشِ خودش: خطای صفِ یک کارخانه نباید بقیه را زمین بزند.
  let offers = 0;
  for (const [tenantId, variantIds] of byTenant) {
    try {
      const made = await withTenant(tenantId, (tx) => advanceWaitlist(tx, tenantId, variantIds));
      offers += made.length;
    } catch (e) {
      console.error(`[expire] صف انتظار برای tenant ${tenantId} جلو نرفت:`, e);
    }
  }

  return { expired: freed.length, offers };
}
