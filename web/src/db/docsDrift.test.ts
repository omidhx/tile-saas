import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * گاردِ drift بین کد و سند.
 *
 * چرا لازم است: `DATABASE_SCHEMA.md` و `API_SPEC.md` **کپیِ دستیِ** چیزی هستند که
 * جای دیگری منبعِ حقیقت دارد. کپی‌ای که عقب می‌افتد از نبودنش بدتر است، چون خواننده
 * به آن اعتماد می‌کند. یک بار همین اتفاق افتاد: شش جدول و شش endpoint مستند نشده
 * بودند و کسی خبر نداشت.
 *
 * این تست جای «یادم باشد سند را به‌روز کنم» را می‌گیرد — با شکستنِ build.
 * محتوا را نمی‌سنجد، فقط **وجودِ نام** را: هدف گرفتنِ فراموشی است، نه بازبینیِ نگارش.
 */

// fileURLToPath و نه .pathname: مسیر فاصله دارد («Claude Site») و pathname
// آن را %20 می‌دهد، که readFileSync پیدایش نمی‌کند.
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

test("هر جدولِ schema.sql در DATABASE_SCHEMA.md نام برده شده", () => {
  const schema = read("db/schema.sql");
  const doc = read("docs/DATABASE_SCHEMA.md");

  const tables = [...schema.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length > 20, `انتظار جدول‌های زیاد، ${tables.length} پیدا شد`);

  const missing = tables.filter((t) => !doc.includes(t));
  assert.deepEqual(missing, [],
    `این جدول‌ها در docs/DATABASE_SCHEMA.md نیستند: ${missing.join(", ")}`);
});

test("هر route.ts زیر app/api در API_SPEC.md نام برده شده", () => {
  const doc = read("docs/API_SPEC.md");
  const base = join(ROOT, "web/src/app/api");

  const routes: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, `${prefix}/${name}`);
      else if (name === "route.ts") routes.push(prefix || "/");
    }
  };
  walk(base, "");
  assert.ok(routes.length > 20, `انتظار endpointهای زیاد، ${routes.length} پیدا شد`);

  // بخشِ آخرِ مسیر کافی است: سند گروهی می‌نویسد («+/:id/approve»)، نه تک‌تکِ کامل.
  // پارامترهای پویا ([id]) هم اسمِ ثابتی برای مستندسازی ندارند.
  const missing = routes
    .filter((r) => !r.includes("["))
    .filter((r) => !doc.includes(`/api${r}`));
  assert.deepEqual(missing, [],
    `این endpointها در docs/API_SPEC.md نیستند: ${missing.join(", ")}`);
});
