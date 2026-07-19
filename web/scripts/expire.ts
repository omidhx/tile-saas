// worker انقضا — برای cron هر ۱۰-۱۵ دقیقه (spec ۵.۳).
// اجرا: npm run worker:expire
// عمداً یک اسکریپتِ کوتاه است نه پروسه‌ی همیشه-روشن: کاری که می‌کند idempotent و
// بی‌حالت است، پس cron ساده‌ترین و لازی‌ترین زمان‌بند است. endpoint عمومی هم نساختم
// که سطحِ حمله اضافه نکند.
//
// main() به‌جای top-level await: package.json تایپ ESM ندارد، پس .ts به‌صورت CJS
// ترنسفورم می‌شود و top-level await در آن خطای نحوی است.
import { expireDueReservations } from "../src/db/expiry";
import { sql } from "../src/db/client";

async function main() {
  const n = await expireDueReservations();
  console.log(`[expire] ${n} reservation(s) marked expired`);
  await sql.end();
}

main().catch((e) => {
  console.error("[expire] failed:", e);
  process.exit(1); // cron باید شکست را ببیند
});
