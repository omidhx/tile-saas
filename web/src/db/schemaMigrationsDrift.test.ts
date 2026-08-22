import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..", "..");

/**
 * تستِ drift بین schema.sql و migrations.
 *
 * این تست بررسی می‌کند که:
 *   ۱. schema.sql شاملِ `_migrations` و `_rate_limit_hits` باشد (migrationهای
 *      ۰۰۰۲ و ۰۰۰۳ همگن با schema.sql هستند).
 *   ۲. schema.sql شاملِ `SET search_path = public, pg_temp` روی همه‌ی توابع
 *      SECURITY DEFINER باشد (migration 0004 همگن با schema.sql است).
 *   ۳. migrationهای ۰۰۰۲، ۰۰۰۳، ۰۰۰۴ وجود دارند و فایل‌های معتبر هستند.
 *
 * تستِ پیچیده‌تر با pg_dump به‌خاطر `DO $$` در postgres.js مشکل داشت. این تست
 * ساده‌تر است ولی همان هدف را دنبال می‌کند: اطمینان از همگامیِ schema.sql
 * و migrations.
 */
test("schema.sql شاملِ جداولِ زیرساختی است (migrationهای 0002 و 0003)", () => {
  const schemaSql = readFileSync(join(ROOT, "db", "schema.sql"), "utf8");

  // جدولِ _migrations (از migration 0002)
  assert.ok(
    schemaSql.includes("CREATE TABLE IF NOT EXISTS _migrations"),
    "schema.sql باید شاملِ CREATE TABLE _migrations باشد",
  );
  assert.ok(
    schemaSql.includes("REVOKE ALL ON _migrations FROM PUBLIC"),
    "schema.sql باید شاملِ REVOKE ON _migrations باشد",
  );

  // جدولِ _rate_limit_hits (از migration 0003)
  assert.ok(
    schemaSql.includes("CREATE TABLE IF NOT EXISTS _rate_limit_hits"),
    "schema.sql باید شاملِ CREATE TABLE _rate_limit_hits باشد",
  );
  assert.ok(
    schemaSql.includes("CREATE INDEX IF NOT EXISTS idx_rate_limit_key_time"),
    "schema.sql باید شاملِ ایندکسِ _rate_limit_hits باشد",
  );
  assert.ok(
    schemaSql.includes("CREATE INDEX IF NOT EXISTS idx_rate_limit_id"),
    "schema.sql باید شاملِ ایندکسِ _rate_limit_hits باشد",
  );
});

test("schema.sql شاملِ SET search_path روی توابع SECURITY DEFINER است (migration 0004)", () => {
  const schemaSql = readFileSync(join(ROOT, "db", "schema.sql"), "utf8");

  // هر چهار تابع باید SET search_path داشته باشند
  const functions = [
    "user_contexts",
    "expire_due_reservations",
    "claim_pending_notifications",
    "finish_notification",
  ];

  for (const fn of functions) {
    // پیدا کردنِ تابع در schema.sql
    const fnIdx = schemaSql.indexOf(`CREATE FUNCTION ${fn}`);
    assert.ok(fnIdx >= 0, `تابع ${fn} در schema.sql باید وجود داشته باشد`);

    // پیدا کردنِ SET search_path بعد از تابع (در همان بلاک)
    const nextFnIdx = schemaSql.indexOf("CREATE FUNCTION", fnIdx + 1);
    const fnBlock = schemaSql.slice(fnIdx, nextFnIdx > 0 ? nextFnIdx : schemaSql.length);
    assert.ok(
      fnBlock.includes("SET search_path = public, pg_temp"),
      `تابع ${fn} در schema.sql باید SET search_path داشته باشد`,
    );
  }
});

test("migrationهای 0002، 0003، 0004 وجود دارند و فایل‌های معتبر هستند", () => {
  const migrationsDir = join(ROOT, "db", "migrations");
  const files = ["0002_migrations_table.sql", "0003_rate_limit_table.sql", "0004_lock_definer_search_path.sql"];

  for (const file of files) {
    const content = readFileSync(join(migrationsDir, file), "utf8");
    assert.ok(content.length > 0, `migration ${file} نباید خالی باشد`);
    assert.ok(content.includes("BEGIN;"), `migration ${file} باید BEGIN; داشته باشد`);
    assert.ok(content.includes("COMMIT;"), `migration ${file} باید COMMIT; داشته باشد`);
  }
});

test("migration 0004 شاملِ CREATE OR REPLACE FUNCTION است (نه CREATE FUNCTION)", () => {
  // این مهم است چون CREATE OR REPLACE مالکیت و grantهای موجود را حفظ می‌کند
  const content = readFileSync(join(ROOT, "db", "migrations", "0004_lock_definer_search_path.sql"), "utf8");
  const functions = ["user_contexts", "expire_due_reservations", "claim_pending_notifications", "finish_notification"];

  for (const fn of functions) {
    assert.ok(
      content.includes(`CREATE OR REPLACE FUNCTION ${fn}`),
      `migration 0004 باید شاملِ CREATE OR REPLACE FUNCTION ${fn} باشد (نه CREATE FUNCTION)`,
    );
  }
});
