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

test("🔴 سرریزِ نقشه فقط کلیدهای راکد را هرس می‌کند — شمارنده‌ی فعال صفر نمی‌شود", () => {
  const day = 24 * 60 * 60 * 1000;
  const staleNow = 1_000_000; // زمانی که کلیدهای مزاحم ثبت می‌شوند
  const activeNow = staleNow + day + 60_000; // خیلی بعدتر — کلیدهای بالا از دیدِ همین لحظه راکدند

  // شمارنده‌ی «قربانی» را در آستانه‌ی مسدودی نگه می‌داریم — نزدیکِ activeNow، نه staleNow
  for (let i = 0; i < 3; i++) checkRate("victim", 3, 60_000, activeNow - 1_000);
  assert.equal(checkRate("victim", 3, 60_000, activeNow - 1_000).ok, false, "قربانی باید همین الان مسدود باشد");

  // نقشه را با کلیدهای یک‌بارمصرفِ راکد (مثلِ IPِ متغیرِ مهاجم) از سقف رد می‌کنیم
  for (let i = 0; i < 10_001; i++) checkRate(`flood-${i}`, 3, 60_000, staleNow);

  // یک ضربه‌ی تازه، sweep را فعال می‌کند — باید فقط کلیدهای راکد را هرس کند
  checkRate("someone-else", 3, 60_000, activeNow);

  assert.equal(checkRate("victim", 3, 60_000, activeNow).ok, false,
    "شمارنده‌ی قربانی نباید با هرسِ کلیدهای راکدِ دیگران صفر شده باشد");
});
