import { sql } from "./client";
import { sendSms, renderMessage } from "@/notify/sender";

const MAX_ATTEMPTS = 5;

/**
 * ارسالِ پیام‌های صف‌شده (spec ۵.۹ + runbook: retry/dead-letter).
 *
 * الگوی claim-then-send:
 *  ۱) یک دستورِ اتمیک ردیف‌ها را «برمی‌دارد» (attempt_count++). `FOR UPDATE SKIP LOCKED`
 *     داخل همین دستور یعنی دو workerِ هم‌زمان یک ردیف را برنمی‌دارند.
 *  ۲) ارسال (I/O شبکه) **بیرون از تراکنش** انجام می‌شود — تراکنشِ باز روی کالِ شبکه‌ی
 *     کند، اتصال‌ها را حبس می‌کند.
 *  ۳) نتیجه ثبت می‌شود.
 * اگر worker بین ۱ و ۳ کرش کند، attempt_count بالا رفته و ردیف pending مانده →
 * اجرای بعدی دوباره تلاش می‌کند (at-least-once). بعد از MAX_ATTEMPTS → failed (dead-letter).
 * cross-tenant است (نگهداری)، پس withTenant ندارد.
 */
export async function sendPendingNotifications(limit = 50): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0;

  // ۱) claim اتمیک
  const claimed = await sql<{ id: string; recipient: string; payload: Record<string, unknown>; attempt_count: number }[]>`
    UPDATE notification_outbox SET attempt_count = attempt_count + 1
    WHERE id IN (
      SELECT id FROM notification_outbox
      WHERE status = 'pending' AND attempt_count < ${MAX_ATTEMPTS}
      ORDER BY created_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, recipient, payload, attempt_count`;

  for (const row of claimed) {
    // ۲) ارسال بیرون از تراکنش
    const result = await sendSms({ to: row.recipient, text: renderMessage(row.payload) });
    // ۳) ثبت نتیجه
    if (result.ok) {
      await sql`UPDATE notification_outbox SET status = 'sent', sent_at = now() WHERE id = ${row.id}`;
      sent++;
    } else {
      if (row.attempt_count >= MAX_ATTEMPTS)
        await sql`UPDATE notification_outbox SET status = 'failed' WHERE id = ${row.id}`;
      failed++; // وگرنه pending می‌ماند و اجرای بعدی دوباره تلاش می‌کند
    }
  }
  return { sent, failed };
}
