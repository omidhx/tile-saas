/**
 * جستجوی متنیِ فارسی-آگاه.
 *
 * دو نکته که خاموش می‌شکنند اگر نباشند:
 *   ۱. ارقامِ فارسی/عربی به لاتین نرمال می‌شوند — نماینده «۶۰۶۰» تایپ می‌کند و
 *      باید کدِ لاتینِ `GB-6060` را پیدا کند.
 *   ۲. `ي`/`ك` عربی به `ی`/`ک` فارسی — کیبوردهای مختلف کاراکترِ متفاوت می‌فرستند.
 */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalize(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))
    .replace(/ي/g, "ی").replace(/ك/g, "ک")
    .trim()
    .toLowerCase();
}

/** آیا `query` در هر یک از `fields` هست؟ nullها نادیده گرفته می‌شوند. */
export function matches(query: string, fields: (string | null | undefined)[]): boolean {
  const q = normalize(query);
  if (!q) return true; // جستجوی خالی = همه
  const hay = normalize(fields.filter(Boolean).join(" "));
  return hay.includes(q);
}
