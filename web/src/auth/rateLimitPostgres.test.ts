import { test, before } from "node:test";
import assert from "node:assert/strict";
import { resetSchema } from "@/db/_testdb";

// BACKEND هنگام import خوانده می‌شود، پس قبل از import پویا ست می‌شود.
process.env.RATE_LIMIT_BACKEND = "postgres";
let checkRateAsync: typeof import("@/auth/rateLimit").checkRateAsync;
let resetRates: typeof import("@/auth/rateLimit").resetRates;
before(async () => {
  ({ checkRateAsync, resetRates } = await import("@/auth/rateLimit"));
});

// فاز ۴: COUNT و INSERT سریالی نبودند و درخواست‌های هم‌زمان از سقف رد می‌شدند.
test("rate limiter postgres: سقف در چند insert موازی رعایت می‌شود", async () => {
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

});

test("rate limiter postgres: کلیدهای متفاوت مستقل‌اند", async () => {
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

});

test("rate limiter postgres: پنجره لغزان است", async () => {
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

});
