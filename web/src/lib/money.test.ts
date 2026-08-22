import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, toDisplayAmount, currencyLabel, formatMoneyWords } from "./money";

test("پیش‌فرض (بدونِ واحد) یعنی ریال، بدونِ تبدیل", () => {
  assert.equal(formatMoney(1_250_000), (1_250_000).toLocaleString("fa-IR") + " ریال");
  assert.equal(formatMoney(1_250_000, "rial"), (1_250_000).toLocaleString("fa-IR") + " ریال");
});

test("تومان یعنی تقسیم بر ۱۰، با گِردِ نزدیک‌ترین", () => {
  assert.equal(formatMoney(1_250_000, "toman"), (125_000).toLocaleString("fa-IR") + " تومان");
  assert.equal(formatMoney(15, "toman"), (2).toLocaleString("fa-IR") + " تومان", "15/10=1.5 → گِردِ به بالا");
  assert.equal(formatMoney(14, "toman"), (1).toLocaleString("fa-IR") + " تومان", "14/10=1.4 → گِردِ به پایین");
});

test("toDisplayAmount عددِ خام می‌دهد — برای ستونِ اکسل، نه رشته‌ی فرمت‌شده", () => {
  assert.equal(toDisplayAmount(1_250_000, "rial"), 1_250_000);
  assert.equal(toDisplayAmount(1_250_000, "toman"), 125_000);
});

test("currencyLabel", () => {
  assert.equal(currencyLabel("rial"), "ریال");
  assert.equal(currencyLabel("toman"), "تومان");
  assert.equal(currencyLabel(), "ریال");
});

test("formatMoneyWords: تبدیل به واحدِ انتخابی، بعد به حروف — ترتیب مهم است", () => {
  assert.equal(formatMoneyWords(4_200_000, "rial"), "چهار میلیون و دویست هزار ریال");
  // همان ریال، وقتی واحد تومان است، اول تقسیم بر ۱۰ می‌شود (۴۲۰٬۰۰۰) و بعد به حروف
  assert.equal(formatMoneyWords(4_200_000, "toman"), "چهارصد و بیست هزار تومان");
});
