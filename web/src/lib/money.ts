import { numberToPersianWords } from "./numberToWords";

export type CurrencyUnit = "rial" | "toman";

/**
 * فرمتِ نمایشیِ مبلغ — تنها لایه‌ای که واحدِ ریال/تومان را می‌بیند.
 *
 * ذخیره‌سازی و محاسبات همیشه ریال (canonical، عددِ صحیح — spec ۱۴.۸) می‌مانند؛
 * این تابع صرفاً برای نمایش تقسیم بر ۱۰ می‌کند. هیچ‌جای دیگری (DB، سقف‌های
 * تأییدِ خودکار، ورودی‌های فرم، اکسپورتِ اکسل به‌جز عددِ نمایشی) این تبدیل را
 * نمی‌بیند — تا گردِ ۱۰تایی هیچ‌وقت وارد مسیرِ پول نشود.
 */
export function formatMoney(rial: number, unit: CurrencyUnit = "rial"): string {
  if (unit === "toman") return `${Math.round(rial / 10).toLocaleString("fa-IR")} تومان`;
  return `${rial.toLocaleString("fa-IR")} ریال`;
}

/** فقط عددِ نمایشی — برای ستونِ اکسل، که باید عدد بماند نه رشته‌ی فرمت‌شده. */
export function toDisplayAmount(rial: number, unit: CurrencyUnit = "rial"): number {
  return unit === "toman" ? Math.round(rial / 10) : rial;
}

/** برچسبِ واحد — برای عنوانِ ستونِ اکسل («ارزش (ریال)» / «ارزش (تومان)»). */
export function currencyLabel(unit: CurrencyUnit = "rial"): string {
  return unit === "toman" ? "تومان" : "ریال";
}

/** مبلغ به حروف — «چهار میلیون و دویست هزار تومان». برای فاکتور/رسید و هرجا که مبلغِ خرید نهایی است. */
export function formatMoneyWords(rial: number, unit: CurrencyUnit = "rial"): string {
  return `${numberToPersianWords(toDisplayAmount(rial, unit))} ${currencyLabel(unit)}`;
}
