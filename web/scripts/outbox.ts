// worker ارسال پیامک — برای cron هر چند دقیقه (spec ۵.۹).
// اجرا: npm run worker:outbox
import { sendPendingNotifications } from "../src/db/outbox";
import { sql } from "../src/db/client";

async function main() {
  const { sent, failed } = await sendPendingNotifications();
  console.log(`[outbox] sent=${sent} failed=${failed}`);
  await sql.end();
}

main().catch((e) => {
  console.error("[outbox] failed:", e);
  process.exit(1);
});
