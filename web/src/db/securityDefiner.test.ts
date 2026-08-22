import { test } from "node:test";
import assert from "node:assert/strict";
import { sql, resetSchema } from "./_testdb";

// این تست فقط روی دیتابیسِ تست اجرا می‌شود (توسط _testdb.ts محافظت می‌شود).
// schema.sql اجرا می‌شود که شاملِ توابعِ SECURITY DEFINER با `SET search_path` است.

test("هر چهار تابعِ SECURITY DEFINER باید SET search_path داشته باشند", async () => {
  await resetSchema();
  const rows = await sql<{ proname: string; proconfig: string[] | null }[]>`
    SELECT proname, proconfig
    FROM pg_proc
    WHERE proname IN ('user_contexts', 'expire_due_reservations',
                      'claim_pending_notifications', 'finish_notification')
    ORDER BY proname`;

  assert.equal(rows.length, 4, "هر چهار تابع باید وجود داشته باشند");

  for (const r of rows) {
    assert.ok(r.proconfig, `${r.proname}: proconfig نباید NULL باشد`);
    // proconfig در PG یک text[] است. فرمت آن می‌تواند:
    //   ['search_path=public, pg_temp']
    //   یا '{search_path=public, pg_temp}'
    // باشد. ما با LIKE رویِ text چک می‌کنیم تا هر دو حالت را بگیرد.
    const configStr = Array.isArray(r.proconfig) ? r.proconfig.join(",") : String(r.proconfig);
    assert.ok(
      configStr.includes("search_path=public, pg_temp") ||
      configStr.includes("search_path=public,pg_temp"),
      `${r.proname}: proconfig باید شاملِ "search_path=public, pg_temp" باشد. واقعی: "${configStr}"`,
    );
  }
});

test("migration 0004 روی دیتابیسِ موجود هم درست اعمال می‌شود", async () => {
  // این تست سناریوی production را شبیه‌سازی می‌کند: دیتابیس با schema.sql
  // (که search_path دارد) ساخته شده، ولی migration 0004 هم باید بدون خطا اجرا شود.
  // این اثبات می‌کند که CREATE OR REPLACE رویِ توابعِ موجود کار می‌کند.
  await resetSchema();

  // اجرای migration 0004 با sql.unsafe
  const fs = await import("node:fs");
  const migration = fs.readFileSync(
    new URL("../../db/migrations/0004_lock_definer_search_path.sql", import.meta.url),
    "utf8",
  );
  // BEGIN;/COMMIT; حذف چون postgres.js روی pool رد می‌کند
  const cleaned = migration.replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
  await sql.unsafe(cleaned);

  // اعتبارسنجی: همه‌ی توابع همچنان search_path دارند
  const rows = await sql<{ proname: string; proconfig: string[] | null }[]>`
    SELECT proname, proconfig
    FROM pg_proc
    WHERE proname IN ('user_contexts', 'expire_due_reservations',
                      'claim_pending_notifications', 'finish_notification')`;
  assert.equal(rows.length, 4);
  for (const r of rows) {
    const configStr = Array.isArray(r.proconfig) ? r.proconfig.join(",") : String(r.proconfig);
    assert.ok(
      configStr.includes("search_path=public, pg_temp") ||
      configStr.includes("search_path=public,pg_temp"),
      `${r.proname} بعد از migration 0004 باید search_path داشته باشد`,
    );
  }
});

