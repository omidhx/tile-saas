/**
 * تاریخِ شمسی (جلالی) برای کلِ سایت.
 *
 * دو قانون:
 *   ۱. هر تاریخی که به کاربر نشان داده می‌شود **شمسی** است.
 *   ۲. همیشه با `Asia/Tehran` رندر می‌شود، نه timezone مرورگر (spec ۱۴.۸:
 *      «timestampها UTC در DB؛ UI با Asia/Tehran»). بدون این، کاربری که ساعت
 *      سیستمش روی منطقه‌ی دیگری است تاریخِ اشتباه می‌بیند.
 *
 * ponytail: تقویم را خودم پیاده نکردم. قواعد کبیسه‌ی شمسی (چرخه‌ی ۳۳ساله) خطاخیزند و
 * `Intl` همین حالا تقویم فارسی را دارد. برای تبدیلِ معکوس (شمسی → میلادی) هم به‌جای
 * بازنویسیِ الگوریتم، از خودِ Intl به‌عنوان مرجعِ حقیقت استفاده و تصحیح می‌کنم.
 */

const TZ = "Asia/Tehran";

/** نمایشِ تاریخ و ساعتِ شمسی (ارقام فارسی). */
export const formatJalaliDateTime = (iso: string | Date) =>
  new Intl.DateTimeFormat("fa-IR", {
    timeZone: TZ, dateStyle: "short", timeStyle: "short",
  }).format(typeof iso === "string" ? new Date(iso) : iso);

/** فقط تاریخِ شمسی. */
export const formatJalaliDate = (iso: string | Date) =>
  new Intl.DateTimeFormat("fa-IR", { timeZone: TZ, dateStyle: "medium" })
    .format(typeof iso === "string" ? new Date(iso) : iso);

export type Jalali = { jy: number; jm: number; jd: number };

/** اجزای شمسیِ یک لحظه، به‌وقت تهران. ارقام لاتین چون برای محاسبه است نه نمایش. */
export function toJalali(d: Date): Jalali {
  const parts = new Intl.DateTimeFormat("en-u-ca-persian", {
    timeZone: TZ, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { jy: get("year"), jm: get("month"), jd: get("day") };
}

const cmp = (a: Jalali, b: Jalali) =>
  a.jy !== b.jy ? a.jy - b.jy : a.jm !== b.jm ? a.jm - b.jm : a.jd - b.jd;

/**
 * شمسی → میلادی. تخمین می‌زند، بعد روز‌به‌روز تصحیح می‌کند تا `toJalali` دقیقاً همان
 * تاریخ را بدهد — یعنی درستی‌اش به تقویمِ خودِ پلتفرم گره خورده، نه به ریاضیِ من.
 * خروجی: **نیمه‌شبِ تهران** آن روز. نه نیمه‌شبِ UTC — آن ۳:۳۰ بامدادِ تهران است و
 * فیلترِ گزارشِ «از ۱ مرداد» بی‌سروصدا سه‌ونیم ساعتِ اولِ روز را می‌انداخت.
 *
 * ponytail: آفستِ ایران ثابت گرفته شده (+۰۳:۳۰). ایران از ۱۴۰۱ ساعتِ تابستانی ندارد؛
 * اگر برگشت، این ثابت باید از Intl محاسبه شود.
 */
const TEHRAN_OFFSET_MS = 3.5 * 3600_000;

export function jalaliToDate({ jy, jm, jd }: Jalali): Date {
  // ابتدای سال شمسی ≈ ۲۱ مارسِ سال میلادیِ jy+621
  const dayOfYear = (jm <= 6 ? (jm - 1) * 31 : 186 + (jm - 7) * 30) + (jd - 1);
  let ms = Date.UTC(jy + 621, 2, 21) + dayOfYear * 86400000;
  for (let i = 0; i < 40; i++) {
    const diff = cmp(toJalali(new Date(ms)), { jy, jm, jd });
    if (diff === 0) break;
    ms += (diff < 0 ? 1 : -1) * 86400000;
  }
  const g = new Date(ms);
  const utcMidnight = Date.UTC(g.getUTCFullYear(), g.getUTCMonth(), g.getUTCDate());
  return new Date(utcMidnight - TEHRAN_OFFSET_MS);
}

export const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
];

/** تعداد روزهای یک ماهِ شمسی — از خودِ تقویم، نه جدولِ دستی (اسفندِ کبیسه ۳۰ روز). */
export function jalaliMonthLength(jy: number, jm: number): number {
  const candidate = jm <= 6 ? 31 : 30;
  // اگر روزِ candidate به ماه بعد سُر خورد، ماه یک روز کوتاه‌تر است
  return toJalali(jalaliToDate({ jy, jm, jd: candidate })).jm === jm ? candidate : candidate - 1;
}

/** امروز به شمسی (وقت تهران). */
export const todayJalali = (): Jalali => toJalali(new Date());
