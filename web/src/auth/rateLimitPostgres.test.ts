import { test } from "node:test";
import assert from "node:assert/strict";

// این تست‌ها فقط وقتی RATE_LIMIT_BACKEND=postgres است معنا دارند. در CI،
// RATE_LIMIT_BACKEND=memory است (پیش‌فرض)، پس این تست‌ها skip می‌شوند.
//
// نکته: به‌جای test.skip() داخل test function (که در Node.js test runner
// ممکنه باعث هنگ کردن بشه)، از شرطِ ساده استفاده می‌کنیم و اگر backend
// postgres نیست، تست را بدون assert رد می‌کنیم.

const isPostgresBackend = process.env.RATE_LIMIT_BACKEND === "postgres";

test("rate limiter postgres: سقف در چند insert موازی رعایت می‌شود", async () => {
  if (!isPostgresBackend) return; // skip در حالتِ memory

  const { sql, resetSchema } = await import("@/db/_testdb");
  const { checkRateAsync, resetRates } = await import("@/auth/rateLimit");

  await resetSchema();
  resetRates();

  const key = `test:parallel:${Date.now()}`;
  const limit = 5;
  const windowMs = 60_000;

  // ۱۰ درخواست موازی — فقط ۵ تای اول باید موفق باشند
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      checkRateAsync(key, limit, windowMs, { failPolicy: "closed" }),
    ),
  );

  const allowed = results.filter((r) => r.ok).length;
  const blocked = results.filter((r) => !r.ok).length;

  assert.equal(allowed, limit, `فقط ${limit} درخواست باید مجاز شوند، نه ${allowed}`);
  assert.equal(blocked, 10 - limit, `بقیه باید block شوند`);

  await sql.end();
});

test("rate limiter postgres: کلیدهای متفاوت مستقل‌اند", async () => {
  if (!isPostgresBackend) return; // skip در حالتِ memory

  const { sql, resetSchema } = await import("@/db/_testdb");
  const { checkRateAsync, resetRates } = await import("@/auth/rateLimit");

  await resetSchema();
  resetRates();

  const limit = 3;
  const windowMs = 60_000;

  // کلید A را تا سقف پر کن
  for (let i = 0; i < limit; i++) {
    const r = await checkRateAsync("test:isolation:A", limit, windowMs, { failPolicy: "closed" });
    assert.equal(r.ok, true);
  }
  const aBlocked = await checkRateAsync("test:isolation:A", limit, windowMs, { failPolicy: "closed" });
  assert.equal(aBlocked.ok, false, "A باید block شود");

  // کلید B باید هنوز مجاز باشد
  const bResult = await checkRateAsync("test:isolation:B", limit, windowMs, { failPolicy: "closed" });
  assert.equal(bResult.ok, true, "B نباید تحت تأثیر A باشد");

  await sql.end();
});

test("rate limiter postgres: پنجره لغزان است", async () => {
  if (!isPostgresBackend) return; // skip در حالتِ memory

  const { sql, resetSchema } = await import("@/db/_testdb");
  const { checkRateAsync, resetRates } = await import("@/auth/rateLimit");

  await resetSchema();
  resetRates();

  const key = `test:window:${Date.now()}`;
  const limit = 3;
  const windowMs = 1_000; // ۱ ثانیه — کوتاه برای تست

  // تا سقف پر کن
  for (let i = 0; i < limit; i++) {
    await checkRateAsync(key, limit, windowMs, { failPolicy: "closed" });
  }
  const blocked1 = await checkRateAsync(key, limit, windowMs, { failPolicy: "closed" });
  assert.equal(blocked1.ok, false);

  // صبر کن تا پنجره بگذرد
  await new Promise((resolve) => setTimeout(resolve, windowMs + 100));

  // حالا باید دوباره مجاز باشد
  const after = await checkRateAsync(key, limit, windowMs, { failPolicy: "closed" });
  assert.equal(after.ok, true, "پنجره باید لغزان باشد");

  await sql.end();
});
