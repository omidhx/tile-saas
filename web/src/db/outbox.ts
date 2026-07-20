import { sql } from "./client";
import { sendSms, renderMessage } from "@/notify/sender";

const MAX_ATTEMPTS = 5;

/**
 * ارسالِ پیام‌های صف‌شده (spec ۵.۹ + runbook: retry/dead-letter).
 *
 * از توابعِ SECURITY DEFINER استفاده می‌کند، نه کوئریِ مستقیم: `notification_outbox`
 * ستون tenant_id دارد پس RLS رویش فعال است، و این worker به هیچ tenantی تعلق ندارد
 * (app.tenant_id ست نمی‌کند). با کوئریِ مستقیم، در production با نقشِ non-superuser
 * صفر ردیف می‌دید و **بی‌صدا هیچ پیامی نمی‌فرستاد** — باگی که فقط زیر RLS واقعی
 * ظاهر می‌شود، نه در dev که با superuser وصل می‌شویم.
 *
 * الگوی claim-then-send: برداشتِ اتمیک (SKIP LOCKED، ضدِ ارسال دوباره توسط دو worker)،
 * سپس ارسال **بیرون از تراکنش** (تا اتصال روی کالِ کندِ شبکه حبس نشود)، سپس ثبتِ نتیجه.
 * کرش بین برداشت و ثبت → ردیف pending می‌ماند و اجرای بعدی دوباره تلاش می‌کند (at-least-once).
 */
export async function sendPendingNotifications(limit = 50): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;

  const claimed = await sql<{ id: string; recipient: string; payload: Record<string, unknown> }[]>`
    SELECT * FROM claim_pending_notifications(${limit}, ${MAX_ATTEMPTS})`;

  for (const row of claimed) {
    const result = await sendSms({ to: row.recipient, text: renderMessage(row.payload) });
    await sql`SELECT finish_notification(${row.id}, ${result.ok}, ${MAX_ATTEMPTS})`;
    if (result.ok) sent++; else failed++;
  }
  return { sent, failed };
}
