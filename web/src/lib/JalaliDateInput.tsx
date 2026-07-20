"use client";
import { JALALI_MONTHS, jalaliMonthLength, type Jalali } from "./date";

/**
 * انتخابگرِ تاریخِ شمسی — سه `<select>` ساده.
 *
 * ponytail: تقویمِ بازشو (popup) نساختم و کتابخانه هم اضافه نکردم. `<input type="date">`
 * فقط میلادی است، پس اینجا واقعاً چاره‌ای جز کد نوشتن نبود؛ ولی سه select با
 * صفحه‌کلید و screen reader بدونِ هیچ کاری کار می‌کنند و روی موبایل هم
 * چرخ‌دنده‌ی بومیِ سیستم را می‌آورند. اگر بعداً «انتخاب از روی تقویمِ ماهانه» لازم شد،
 * همان‌جا اضافه می‌شود.
 *
 * روزهای ماه از خودِ تقویم می‌آید، پس ۳۱ اسفند هرگز قابلِ انتخاب نیست.
 */

const YEAR_SPAN = 5; // چند سالِ گذشته در فهرست بیاید

export function JalaliDateInput(props: {
  label: string;
  value: Jalali;
  onChange: (v: Jalali) => void;
  /** سالِ جاری، برای ساختنِ فهرستِ سال‌ها. */
  currentYear: number;
}) {
  const { label, value, onChange, currentYear } = props;
  const years = Array.from({ length: YEAR_SPAN + 1 }, (_, i) => currentYear - YEAR_SPAN + i);
  const days = jalaliMonthLength(value.jy, value.jm);

  // اگر ماه/سال عوض شد و روزِ فعلی از ماهِ جدید بیرون زد، به آخرین روز می‌چسبد
  const emit = (v: Jalali) => onChange({ ...v, jd: Math.min(v.jd, jalaliMonthLength(v.jy, v.jm)) });

  const sel = { maxWidth: 110, marginInlineStart: ".3rem" } as const;

  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, display: "flex", gap: ".3rem", alignItems: "center" }}>
      <legend style={{ float: "inline-start", padding: 0, marginInlineEnd: ".4rem" }}>{label}</legend>
      <select aria-label={`${label} — روز`} value={value.jd} style={sel}
        onChange={(e) => emit({ ...value, jd: Number(e.target.value) })}>
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>{d.toLocaleString("fa-IR")}</option>
        ))}
      </select>
      <select aria-label={`${label} — ماه`} value={value.jm} style={{ ...sel, maxWidth: 130 }}
        onChange={(e) => emit({ ...value, jm: Number(e.target.value) })}>
        {JALALI_MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
      </select>
      <select aria-label={`${label} — سال`} value={value.jy} style={sel}
        onChange={(e) => emit({ ...value, jy: Number(e.target.value) })}>
        {years.map((y) => <option key={y} value={y}>{y.toLocaleString("fa-IR", { useGrouping: false })}</option>)}
      </select>
    </fieldset>
  );
}
