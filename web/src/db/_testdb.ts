import { readFileSync } from "node:fs";
import { sql } from "./client";

// اسکیمای تازه از schema.sql (منبع حقیقت). هر فایل تست قبل از seedِ خودش صداش می‌زنه؛
// با --test-concurrency=1 فایل‌ها سریال اجرا می‌شن، پس یک DB مشترک امنه.
export async function resetSchema() {
  const schema = readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8")
    // BEGIN;/COMMIT; حذف: postgres.js تراکنش صریح روی pool را رد می‌کنه (UNSAFE_TRANSACTION)
    .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await sql.unsafe(schema);
}
