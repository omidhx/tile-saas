import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { sql, resetSchema } from "./_testdb";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * تستِ drift بین schema.sql و migrations.
 *
 * این تست دو دیتابیس می‌سازد:
 *   A. با schema.sql (نصبِ تازه)
 *   B. با schema.sql (به‌عنوانِ نصبِ اولیه) + migrationهای 0002, 0003, 0004
 *      (که با IF NOT EXISTS یا CREATE OR REPLACE قابلِ اجرا روی دیتابیسِ موجود)
 *
 * بعد `pg_dump --schema-only` هر دو را می‌گیرد و مقایسه می‌کند. اگر اختلافی
 * باشد، یعنی schema.sql با migrations همگام نیست — یک منبع حقیقت داریم که
 * با دیگری نمی‌خواند.
 *
 * این تست فقط وقتی معنا دارد که `pg_dump` در دسترس باشد. در CI با PostgreSQL
 * داکری، هست.
 */
test("schema.sql و migrations باید همگام باشند — pg_dump --schema-only یکسان", async () => {
  // این تست نیاز به pg_dump دارد — در CI هست، در dev ممکن است نباشد
  let pgDumpAvailable = false;
  try {
    execFileSync("pg_dump", ["--version"], { stdio: "ignore" });
    pgDumpAvailable = true;
  } catch {
    // pg_dump نیست — skip
  }

  if (!pgDumpAvailable) {
    test.skip("pg_dump در دسترس نیست — این تست را روی CI اجرا کن");
    return;
  }

  // ۱. دیتابیس A: فقط schema.sql
  await resetSchema();
  const dumpA = execFileSync("pg_dump", [
    "--schema-only",
    "--no-owner",
    "--no-privileges",
    process.env.DATABASE_URL!,
  ], { encoding: "utf8" });

  // ۲. دیتابیس B: schema.sql + migrationهای 0002, 0003, 0004
  //    (resetSchema قبلاً schema.sql را زده، حالا migrationها را هم بزن)
  const migrationsDir = new URL("../../../db/migrations/", import.meta.url).pathname;
  for (const file of ["0002_migrations_table.sql", "0003_rate_limit_table.sql", "0004_lock_definer_search_path.sql"]) {
    const content = readFileSync(join(migrationsDir, file), "utf8")
      .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
    await sql.unsafe(content);
  }
  const dumpB = execFileSync("pg_dump", [
    "--schema-only",
    "--no-owner",
    "--no-privileges",
    process.env.DATABASE_URL!,
  ], { encoding: "utf8" });

  // ۳. مقایسه — باید یکسان باشند (جز جدولِ `_migrations` که فقط در B هست، چون
  //    apply.ts آن را INSERT می‌کند نه schema.sql)
  //    پس `_migrations` را از هر دو dump حذف می‌کنیم.
  const normalize = (dump: string) => dump
    .replace(/CREATE TABLE _migrations[\s\S]*?;\n/g, "")
    .replace(/CREATE INDEX.*_migrations.*;\n/g, "")
    .replace(/REVOKE.*_migrations.*;\n/g, "")
    .replace(/GRANT.*_migrations.*;\n/g, "")
    .replace(/^--.*$/gm, "") // کامنت‌ها
    .replace(/\s+/g, " ") // whitespace
    .trim();

  const normA = normalize(dumpA);
  const normB = normalize(dumpB);

  if (normA !== normB) {
    // diff کوتاه برای دیباگ
    const linesA = normA.split(";");
    const linesB = normB.split(";");
    const max = Math.max(linesA.length, linesB.length);
    const diffs: string[] = [];
    for (let i = 0; i < max; i++) {
      if (linesA[i] !== linesB[i]) {
        diffs.push(`  Line ${i + 1}:\n    A: ${(linesA[i] ?? "").trim().slice(0, 100)}\n    B: ${(linesB[i] ?? "").trim().slice(0, 100)}`);
        if (diffs.length > 5) break;
      }
    }
    assert.fail(
      `schema.sql و migrations همگام نیستند.\n` +
      `اولین تفاوت‌ها:\n${diffs.join("\n")}\n\n` +
      `هر تغییری در schema باید در هر دو جا انجام شود — schema.sql و یک migration جدید.`,
    );
  }
});
