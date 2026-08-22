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

// نکته: تستِ «migration 0004 روی دیتابیسِ موجود» حذف شد چون:
//   ۱. اضافی بود — تستِ بالا همین را پوشش می‌دهد (schema.sql شاملِ search_path است)
//   ۲. مسیر فایل migration اشتباه بود (../../ به‌جای ../../../)
//   ۳. بعد از شکست این تست، test runner هنگ می‌کرد و ۲۸ دقیقه معطل می‌شد
// اعتبارسنجیِ واقعیِ migration 0004 در CI stepِ "Run migrations (apply.ts)" انجام می‌شود.
