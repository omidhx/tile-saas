import { test } from "node:test";
import assert from "node:assert/strict";
import { loadError, actionError } from "./api";

/**
 * پیام‌های خطا. منطقِ خالص، ولی چیزی که قفل می‌کند این است: **۴۰۹ یک شکست نیست،
 * یک تعارض است** و باید پیامِ متفاوت بدهد. عملیاتِ نوشتنِ staff (تأیید/حواله) وقتی
 * ۴۰۹ می‌گیرد یعنی «همین حالا چیزی تغییر کرد» نه «کار خراب شد» — و کاربر باید
 * بفهمد که باید فهرستِ تازه را ببیند، نه اینکه دوباره همان دکمه را بزند.
 */

test("۴۰۹ در actionError «تعارض» است نه «شکست»", () => {
  const msg = actionError(409);
  assert.match(msg, /همین حالا|تغییر/, "باید بگوید چیزی تغییر کرد، نه فقط «خطا»");
  assert.notEqual(msg, actionError(500), "۴۰۹ و ۵۰۰ نباید یک پیام بدهند");
});

test("۰ یعنی به سرور نرسیدیم — در هر دو helper", () => {
  assert.match(loadError(0), /ارتباط/);
  assert.match(actionError(0), /ارتباط/);
});

test("۴۰۳/۴۰۱ پیامِ اختصاصیِ خودشان را دارند، نه عددِ خام", () => {
  for (const fn of [loadError, actionError]) {
    assert.doesNotMatch(fn(403), /403/, "کدِ خام نباید به کاربر برسد");
    assert.doesNotMatch(fn(401), /401/);
    assert.match(fn(401), /نشست/, "۴۰۱ باید بگوید نشست منقضی شده");
  }
});

test("کدِ ناشناخته عدد را نشان می‌دهد (تا برای پشتیبانی قابلِ گزارش باشد)", () => {
  assert.match(actionError(502), /502/);
  assert.match(loadError(502), /502/);
});
