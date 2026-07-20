import { readFileSync } from "node:fs";
import { sql } from "./client";

// اسکیمای تازه از schema.sql (منبع حقیقت). هر فایل تست قبل از seedِ خودش صداش می‌زنه؛
// با --test-concurrency=1 فایل‌ها سریال اجرا می‌شن، پس یک DB مشترک امنه.
/**
 * گاردِ ایمنی: این تابع کلِ schema را DROP می‌کند. اگر `DATABASE_URL` به‌اشتباه به
 * پایگاه‌داده‌ی توسعه یا تولید اشاره کند، همه‌چیز بی‌سروصدا پاک می‌شود.
 * پس نامِ DB باید صریحاً به `_test` ختم شود — یک بار همین اتفاق افتاد.
 */
function assertTestDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL تنظیم نشده — تست‌ها با --env-file=.env.test اجرا می‌شوند.");
  const dbName = new URL(url).pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `تست‌ها فقط روی پایگاه‌داده‌ای که نامش به «_test» ختم می‌شود اجرا می‌شوند. ` +
      `الان: «${dbName}». (resetSchema کلِ schema را DROP می‌کند.)`,
    );
  }
}

export async function resetSchema() {
  assertTestDatabase();
  const schema = readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8")
    // BEGIN;/COMMIT; حذف: postgres.js تراکنش صریح روی pool را رد می‌کنه (UNSAFE_TRANSACTION)
    .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await sql.unsafe(schema);
}
