import { test } from "node:test";
import assert from "node:assert/strict";
import { numberToPersianWords } from "./numberToWords";

test("صفر و یکان‌ها", () => {
  assert.equal(numberToPersianWords(0), "صفر");
  assert.equal(numberToPersianWords(1), "یک");
  assert.equal(numberToPersianWords(9), "نه");
});

test("ده تا نوزده (استثنا)", () => {
  assert.equal(numberToPersianWords(10), "ده");
  assert.equal(numberToPersianWords(15), "پانزده");
  assert.equal(numberToPersianWords(19), "نوزده");
});

test("دهگان + یکان با «و»", () => {
  assert.equal(numberToPersianWords(20), "بیست");
  assert.equal(numberToPersianWords(21), "بیست و یک");
  assert.equal(numberToPersianWords(99), "نود و نه");
});

test("صدگان", () => {
  assert.equal(numberToPersianWords(100), "صد");
  assert.equal(numberToPersianWords(101), "صد و یک");
  assert.equal(numberToPersianWords(999), "نهصد و نود و نه");
});

test("هزار — «یک هزار» گفته نمی‌شود، فقط «هزار»", () => {
  assert.equal(numberToPersianWords(1000), "هزار");
  assert.equal(numberToPersianWords(1001), "هزار و یک");
  assert.equal(numberToPersianWords(2000), "دو هزار");
  assert.equal(numberToPersianWords(45000), "چهل و پنج هزار");
});

test("میلیون/میلیارد — «یک» حذف نمی‌شود", () => {
  assert.equal(numberToPersianWords(1_000_000), "یک میلیون");
  assert.equal(numberToPersianWords(1_000_000_000), "یک میلیارد");
});

test("گروه‌های صفر رد می‌شوند (نه «و صفر هزار»)", () => {
  assert.equal(numberToPersianWords(1_000_001), "یک میلیون و یک");
  assert.equal(numberToPersianWords(1_000_000_000), "یک میلیارد"); // هزار و میلیون هردو صفرند
});

test("مبلغِ واقعیِ سفارش (مثالِ سبد)", () => {
  assert.equal(numberToPersianWords(4_200_000), "چهار میلیون و دویست هزار");
  assert.equal(numberToPersianWords(181_690_000), "صد و هشتاد و یک میلیون و ششصد و نود هزار");
});

test("عددِ منفی/اعشاری/نامتناهی رد می‌شود", () => {
  assert.throws(() => numberToPersianWords(-1));
  assert.throws(() => numberToPersianWords(1.5));
  assert.throws(() => numberToPersianWords(NaN));
});
