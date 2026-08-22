"use client";
import { useEffect, useRef, useState } from "react";
import { normalize } from "@/lib/search";

const money = (v: number) => v.toLocaleString("fa-IR");
const fmtUnit = (n: number) => n.toLocaleString("fa-IR", { maximumFractionDigits: 2 });

type Unit = "box" | "pallet" | "sqm";

/**
 * ورودیِ تعداد با انتخابِ واحد (کارتن/پالت/مترمربع). بسته‌بندی مشخصه‌ی ثابتِ
 * کارخانه است (پشتیبان در مدیریتِ محصول تنظیمش می‌کند)، پس اینجا فقط تبدیل
 * می‌شود — نه چیزی که نماینده هر بار حدس بزند.
 *
 * منبعِ حقیقت همیشه `value` (کارتن، در cart) است؛ `text` فقط بازنمودِ محلیِ
 * واحدِ انتخاب‌شده است تا کاربر بتواند اعشار تایپ کند بدونِ فرمت‌شدنِ هر keystroke.
 * اگر تبدیل به سقفِ موجودی بخورد، متن با معادلِ واقعی جایگزین می‌شود — وگرنه
 * عددِ نمایش‌داده‌شده با آنچه واقعاً رزرو می‌شود فرق می‌کرد.
 */
export default function QtyPicker({
  id, label, max, boxesPerPallet, sqcmPerBox, value, onChange,
}: {
  id: string; label: string; max: number;
  boxesPerPallet: number | null; sqcmPerBox: number | null;
  value: number; onChange: (boxes: number) => void;
}) {
  const [unit, setUnit] = useState<Unit>("box");
  const [text, setText] = useState(value > 0 ? String(value) : "");
  const hasFactor = boxesPerPallet != null || sqcmPerBox != null;
  // آخرین مقداری که خودِ این کامپوننت به بیرون فرستاده — برای تشخیصِ اینکه
  // آیا `value` از بیرون عوض شده (مثلاً سبد بر اساسِ موجودیِ تازه کلمپ شد)
  // یا فقط اکوی همان چیزی است که خودمان لحظه‌ای پیش فرستادیم.
  const lastPushed = useRef(value);

  // اگر `value` از بیرون تغییر کرد (نه در واکنش به تایپِ خودِ کاربر اینجا)،
  // متنِ محلی هم باید هم‌گام شود — وگرنه کادر عددی نشان می‌دهد که دیگر واقعی نیست
  // (مثلاً بعدِ کلمپ‌شدنِ سبد، ورودی هنوز مقدارِ قدیمیِ بزرگ‌تر را نشان می‌دهد).
  useEffect(() => {
    if (value === lastPushed.current) return;
    lastPushed.current = value;
    if (value === 0) setText("");
    else if (unit === "box") setText(String(value));
    else if (unit === "pallet") setText(fmtUnit(value / (boxesPerPallet ?? 1)));
    else setText(fmtUnit((value * (sqcmPerBox ?? 0)) / 10000));
  }, [value]);

  function toBoxes(n: number, u: Unit): number {
    if (u === "box") return Math.floor(n);
    if (u === "pallet") return Math.ceil(n * (boxesPerPallet ?? 0));
    return Math.ceil((n * 10000) / (sqcmPerBox || 1));
  }

  function commit(raw: string, u: Unit) {
    setText(raw);
    const n = Number(normalize(raw).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) { lastPushed.current = 0; onChange(0); return; }
    const boxes = toBoxes(n, u);
    const clamped = Math.max(0, Math.min(max, boxes));
    lastPushed.current = clamped;
    onChange(clamped);
    if (clamped !== boxes) {
      // به سقفِ موجودی خورد — متن باید معادلِ واقعیِ رزروشده را نشان دهد، نه عددِ خام‌تایپ‌شده
      if (u === "box") setText(String(clamped));
      else if (u === "pallet") setText(fmtUnit(clamped / (boxesPerPallet ?? 1)));
      else setText(fmtUnit((clamped * (sqcmPerBox ?? 0)) / 10000));
    }
  }

  function switchUnit(u: Unit) {
    setUnit(u);
    if (value <= 0) { setText(""); return; }
    if (u === "box") setText(String(value));
    else if (u === "pallet") setText(fmtUnit(value / (boxesPerPallet ?? 1)));
    else setText(fmtUnit((value * (sqcmPerBox ?? 0)) / 10000));
  }

  const placeholder = unit === "box" ? "تعداد کارتن" : unit === "pallet" ? "تعداد پالت" : "متراژ (مترمربع)";

  return (
    <div style={{ marginTop: "var(--sp-3)" }}>
      <div className="row row--start" style={{ flexWrap: "wrap" }}>
        <label htmlFor={id} className="sr-only">{label}</label>
        <input id={id} type="text" inputMode="decimal" placeholder={placeholder}
               value={text} style={{ maxWidth: 130 }}
               onChange={(e) => commit(e.target.value, unit)} />
        {hasFactor ? (
          <select aria-label="واحدِ ورود" value={unit} onChange={(e) => switchUnit(e.target.value as Unit)} style={{ maxWidth: 110 }}>
            <option value="box">کارتن</option>
            {boxesPerPallet != null && <option value="pallet">پالت</option>}
            {sqcmPerBox != null && <option value="sqm">مترمربع</option>}
          </select>
        ) : <span className="subtle">کارتن</span>}
      </div>
      {value > 0 && hasFactor && (
        <div className="subtle" style={{ marginTop: "var(--sp-1)" }}>
          معادل: {money(value)} کارتن
          {boxesPerPallet != null && ` · ${fmtUnit(value / boxesPerPallet)} پالت`}
          {sqcmPerBox != null && ` · ${fmtUnit((value * sqcmPerBox) / 10000)} مترمربع`}
        </div>
      )}
    </div>
  );
}
