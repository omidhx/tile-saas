// worker پاکسازی: ردیف‌های قدیمیِ rate limit، وگرنه این جدول بی‌سقف بزرگ می‌شود.
import { sql } from "../src/db/client";

async function main() {
  const { count } = await sql`DELETE FROM _rate_limit_hits WHERE hit_at < now() - interval '24 hours'`;
  console.log(`[housekeeping] deleted=${count}`);
  await sql.end();
}

main().catch((e) => {
  console.error("[housekeeping] failed:", e);
  process.exit(1);
});
