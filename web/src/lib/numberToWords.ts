const ONES = ["", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه"];
const TEENS = ["ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده", "هفده", "هجده", "نوزده"];
const TENS = ["", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود"];
const HUNDREDS = ["", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد"];
// تا ۱۰^۱۸ (کوئینتیلیون) — چند برابرِ بزرگ‌ترین مبلغِ ریالیِ واقع‌بینانه، برای این‌که هیچ‌وقت کم نیاورد
const SCALES = ["", "هزار", "میلیون", "میلیارد", "بیلیون", "بیلیارد", "تریلیون"];

function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100), r = n % 100;
  if (h > 0) parts.push(HUNDREDS[h]);
  if (r >= 10 && r < 20) parts.push(TEENS[r - 10]);
  else if (r > 0) {
    const t = Math.floor(r / 10), o = r % 10;
    if (t > 0) parts.push(o > 0 ? `${TENS[t]} و ${ONES[o]}` : TENS[t]);
    else parts.push(ONES[o]);
  }
  return parts.join(" و ");
}

/** عددِ صحیحِ نامنفی را به حروفِ فارسی برمی‌گرداند. برای اعشار/منفی طراحی نشده — پول همیشه عددِ صحیح است (قانون #۷). */
export function numberToPersianWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n))
    throw new Error(`numberToPersianWords فقط عددِ صحیحِ نامنفی می‌پذیرد: ${n}`);
  if (n === 0) return "صفر";

  const groups: number[] = [];
  let rest = n;
  while (rest > 0) { groups.unshift(rest % 1000); rest = Math.floor(rest / 1000); }
  if (groups.length > SCALES.length) throw new Error("عدد بزرگ‌تر از دامنه‌ی پشتیبانی‌شده است");

  const parts: string[] = [];
  groups.forEach((g, i) => {
    if (g === 0) return;
    const scale = SCALES[groups.length - 1 - i]; // groups[0] پرارزش‌ترین است، groups[آخر] یکان‌هاست (مقیاسِ "")
    // «یک هزار» در فارسیِ روزمره فقط «هزار» گفته می‌شود؛ برای بقیه‌ی مقیاس‌ها «یک» می‌ماند («یک میلیون»)
    const words = g === 1 && scale === "هزار" ? scale : `${threeDigitsToWords(g)}${scale ? " " + scale : ""}`;
    parts.push(words);
  });
  return parts.join(" و ");
}
