import { test } from "node:test";
import assert from "node:assert/strict";
import { toJalali, jalaliToDate, jalaliMonthLength, JALALI_MONTHS } from "./date";

/**
 * تنها چیزی که واقعاً می‌تواند بشکند، حلقه‌ی تصحیحِ `jalaliToDate` است.
 * پس همان را رفت‌وبرگشتی روی چند سالِ پیوسته می‌سنجیم — از جمله سال‌های کبیسه.
 */

test("رفت‌وبرگشت: هر روزِ ۱۴۰۰ تا ۱۴۰۵ به همان تاریخ برمی‌گردد", () => {
  for (let jy = 1400; jy <= 1405; jy++) {
    for (let jm = 1; jm <= 12; jm++) {
      const len = jalaliMonthLength(jy, jm);
      for (let jd = 1; jd <= len; jd++) {
        const back = toJalali(jalaliToDate({ jy, jm, jd }));
        assert.deepEqual(back, { jy, jm, jd }, `${jy}/${jm}/${jd}`);
      }
    }
  }
});

test("طول ماه‌ها: ۶ ماه اول ۳۱، پنج ماه بعد ۳۰، اسفند ۲۹ یا ۳۰", () => {
  for (let jy = 1400; jy <= 1410; jy++) {
    for (let jm = 1; jm <= 6; jm++) assert.equal(jalaliMonthLength(jy, jm), 31);
    for (let jm = 7; jm <= 11; jm++) assert.equal(jalaliMonthLength(jy, jm), 30);
    const esfand = jalaliMonthLength(jy, 12);
    assert.ok(esfand === 29 || esfand === 30, `اسفند ${jy} = ${esfand}`);
  }
  // ۱۴۰۳ کبیسه است (اسفندِ ۳۰ روزه)
  assert.equal(jalaliMonthLength(1403, 12), 30);
});

test("نوروز: ۱ فروردین همیشه ۲۰ یا ۲۱ مارس است", () => {
  for (let jy = 1400; jy <= 1410; jy++) {
    const d = jalaliToDate({ jy, jm: 1, jd: 1 });
    const g = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
    assert.ok(g.endsWith("-03-20") || g.endsWith("-03-21"), `${jy} → ${g}`);
  }
});

test("مرزِ روز، نیمه‌شبِ تهران است نه UTC — سه‌ونیم ساعتِ اولِ روز نمی‌افتد", () => {
  const start = jalaliToDate({ jy: 1404, jm: 5, jd: 1 });
  const t = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(start);
  assert.equal(t, "00:00", "شروعِ بازه باید دقیقاً نیمه‌شبِ تهران باشد");
});

test("نام ماه‌ها کامل است", () => {
  assert.equal(JALALI_MONTHS.length, 12);
  assert.equal(JALALI_MONTHS[0], "فروردین");
  assert.equal(JALALI_MONTHS[11], "اسفند");
});
