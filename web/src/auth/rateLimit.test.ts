import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { checkRate, resetRates } from "./rateLimit";

beforeEach(() => resetRates());

test("تا سقف اجازه می‌دهد، بعدش ۴۲۹ با Retry-After", () => {
  const now = 1_000_000;
  for (let i = 0; i < 3; i++)
    assert.equal(checkRate("k", 3, 60_000, now).ok, true, `ضربه ${i + 1} باید مجاز باشد`);

  const blocked = checkRate("k", 3, 60_000, now);
  assert.equal(blocked.ok, false, "ضربه‌ی چهارم باید رد شود");
  assert.ok(blocked.retryAfterSec > 0 && blocked.retryAfterSec <= 60, "Retry-After منطقی");
});

test("پنجره لغزان است: بعد از گذشتِ پنجره دوباره باز می‌شود", () => {
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) checkRate("k", 3, 60_000, now);
  assert.equal(checkRate("k", 3, 60_000, now).ok, false);

  // ۶۱ ثانیه بعد → همه‌ی ضربه‌های قبلی از پنجره خارج شده‌اند
  assert.equal(checkRate("k", 3, 60_000, now + 61_000).ok, true);
});

test("کلیدها از هم مستقل‌اند (یک IP بقیه را قفل نمی‌کند)", () => {
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) checkRate("ip-a", 3, 60_000, now);
  assert.equal(checkRate("ip-a", 3, 60_000, now).ok, false);
  assert.equal(checkRate("ip-b", 3, 60_000, now).ok, true, "کلید دیگر نباید متأثر شود");
});
