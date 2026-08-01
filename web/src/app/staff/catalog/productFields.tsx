"use client";
import { useState } from "react";
import { normalize, matches } from "@/lib/search";

export type FieldValues = {
  color: string; glaze: string; punch: string; body: string;
  size: string; thickness: string; usageArea: string; description: string;
  boxesPerPallet: string; sqmPerBox: string;
};
export type AttrKey = "color" | "glaze" | "punch" | "body" | "size" | "thickness" | "usageArea";

/** ورودیِ عددیِ اختیاری (ارقامِ فارسی هم می‌پذیرد): خالی=null (معتبر)، وگرنه باید عددِ صحیحِ مثبت باشد. */
export function parsePackInt(s: string): { ok: true; value: number | null } | { ok: false } {
  if (!s.trim()) return { ok: true, value: null };
  const n = Number(normalize(s).replace(/[^0-9]/g, ""));
  return Number.isInteger(n) && n > 0 ? { ok: true, value: n } : { ok: false };
}
/** مثلِ parsePackInt ولی اعشاری (متراژ) — نقطه هم مجاز است. */
export function parsePackNum(s: string): { ok: true; value: number | null } | { ok: false } {
  if (!s.trim()) return { ok: true, value: null };
  const n = Number(normalize(s).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? { ok: true, value: n } : { ok: false };
}

/**
 * انتخابِ سریع از مقدارهایی که قبلاً برای همین فیلد (رنگ/سایز/...) در محصولاتِ
 * دیگر وارد شده — تا پشتیبان دوباره تایپ نکند. هیچ ذخیره‌ی جداگانه‌ای لازم نیست:
 * «ذخیره‌شدن» یعنی همان مقدار الان روی یک محصول نشسته، پس از همان لیستِ
 * محصولات مشتق می‌شود. اگر لیست بلند شد (>۸)، یک کادرِ جستجو هم اضافه می‌شود.
 */
export function QuickPick({ label, options, onPick }: { label: string; options: string[]; onPick: (v: string) => void }) {
  const [q, setQ] = useState("");
  if (options.length === 0) return null;
  const visible = options.filter((o) => matches(q, [o]));
  return (
    <div style={{ marginTop: "var(--sp-1)" }}>
      {options.length > 8 && (
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder={`جستجو در ${label}‌های قبلی…`} aria-label={`جستجو در ${label}‌های ثبت‌شده`}
               style={{ marginBottom: "var(--sp-1)", maxWidth: 220 }} />
      )}
      <div className="row row--start" style={{ flexWrap: "wrap", gap: ".3rem", justifyContent: "flex-start" }}>
        {visible.length === 0
          ? <span className="subtle">موردی یافت نشد.</span>
          : visible.map((o) => (
              <button key={o} type="button" className="chip" onClick={() => onPick(o)}>{o}</button>
            ))}
      </div>
    </div>
  );
}

/** فیلدهای رنگ/لعاب/پانچ/بدنه + QuickPick — در فرمِ ساخت و ویرایش مشترک‌اند. */
export function AttrFields({ v, set, keyId, distinctVal }: {
  v: FieldValues; set: (patch: Partial<FieldValues>) => void; keyId: string; distinctVal: (key: AttrKey) => string[];
}) {
  return (
    <div className="grid2">
      <div><label htmlFor={`cl-${keyId}`}>رنگ</label>
        <input id={`cl-${keyId}`} value={v.color} onChange={(e) => set({ color: e.target.value })} placeholder="طوسی" />
        <QuickPick label="رنگ" options={distinctVal("color")} onPick={(val) => set({ color: val })} /></div>
      <div><label htmlFor={`gl-${keyId}`}>لعاب</label>
        <input id={`gl-${keyId}`} value={v.glaze} onChange={(e) => set({ glaze: e.target.value })} placeholder="مات / ترانس" />
        <QuickPick label="لعاب" options={distinctVal("glaze")} onPick={(val) => set({ glaze: val })} /></div>
      <div><label htmlFor={`pn-${keyId}`}>پانچ</label>
        <input id={`pn-${keyId}`} value={v.punch} onChange={(e) => set({ punch: e.target.value })} placeholder="تخت / رستیک" />
        <QuickPick label="پانچ" options={distinctVal("punch")} onPick={(val) => set({ punch: val })} /></div>
      <div><label htmlFor={`bd-${keyId}`}>بدنه</label>
        <input id={`bd-${keyId}`} value={v.body} onChange={(e) => set({ body: e.target.value })} placeholder="سفید / قرمز" />
        <QuickPick label="بدنه" options={distinctVal("body")} onPick={(val) => set({ body: val })} /></div>
    </div>
  );
}

/** فیلدهای «اطلاعاتِ بیشتر» — در فرمِ ساخت و ویرایش مشترک‌اند. */
export function MoreFields({ v, set, keyId, distinctVal }: {
  v: FieldValues; set: (patch: Partial<FieldValues>) => void; keyId: string; distinctVal: (key: AttrKey) => string[];
}) {
  // پیش‌نمایشِ زنده‌ی فرمول — فقط وقتی حداقل یکی از دو مقدار معتبر باشد
  const bpp = parsePackInt(v.boxesPerPallet);
  const spb = parsePackNum(v.sqmPerBox);
  const preview: string[] = [];
  if (spb.ok && spb.value != null) preview.push(`هر کارتن ≈ ${spb.value.toLocaleString("fa-IR", { maximumFractionDigits: 2 })} مترمربع`);
  if (bpp.ok && bpp.value != null) preview.push(`هر پالت = ${bpp.value.toLocaleString("fa-IR")} کارتن`);
  if (bpp.ok && bpp.value != null && spb.ok && spb.value != null)
    preview.push(`هر پالت ≈ ${(bpp.value * spb.value).toLocaleString("fa-IR", { maximumFractionDigits: 2 })} مترمربع`);

  return (
    <details className="more-info">
      <summary>اطلاعاتِ بیشتر (اختیاری) — ابعاد، ضخامت، کاربری، بسته‌بندی، توضیحات</summary>
      <div className="grid2" style={{ marginTop: "var(--sp-2)" }}>
        <div><label htmlFor={`sz-${keyId}`}>ابعاد</label>
          <input id={`sz-${keyId}`} value={v.size} onChange={(e) => set({ size: e.target.value })} placeholder="۶۰×۶۰" />
          <QuickPick label="ابعاد" options={distinctVal("size")} onPick={(val) => set({ size: val })} /></div>
        <div><label htmlFor={`th-${keyId}`}>ضخامت</label>
          <input id={`th-${keyId}`} value={v.thickness} onChange={(e) => set({ thickness: e.target.value })} placeholder="۹ میلی‌متر" />
          <QuickPick label="ضخامت" options={distinctVal("thickness")} onPick={(val) => set({ thickness: val })} /></div>
        <div><label htmlFor={`ua-${keyId}`}>کاربری</label>
          <input id={`ua-${keyId}`} value={v.usageArea} onChange={(e) => set({ usageArea: e.target.value })} placeholder="کف / دیوار / نما" />
          <QuickPick label="کاربری" options={distinctVal("usageArea")} onPick={(val) => set({ usageArea: val })} /></div>
      </div>

      {/* بسته‌بندی: پایه‌ی فرمولِ تبدیلِ کارتن⇄پالت⇄مترمربع که نماینده در سفارش می‌بیند.
          مشخصه‌ی ثابتِ کارخانه است — یک‌بار اینجا تنظیم می‌شود، نه هر بار توسطِ نماینده. */}
      <div className="grid2" style={{ marginTop: "var(--sp-3)" }}>
        <div><label htmlFor={`bpp-${keyId}`}>تعداد کارتن در هر پالت</label>
          <input id={`bpp-${keyId}`} inputMode="numeric" value={v.boxesPerPallet}
            onChange={(e) => set({ boxesPerPallet: e.target.value })} placeholder="۴۸" /></div>
        <div><label htmlFor={`spb-${keyId}`}>متراژِ هر کارتن (مترمربع)</label>
          <input id={`spb-${keyId}`} inputMode="decimal" value={v.sqmPerBox}
            onChange={(e) => set({ sqmPerBox: e.target.value })} placeholder="۱٫۴۴" /></div>
      </div>
      <p className="subtle" style={{ marginTop: "var(--sp-1)" }}>
        این دو عدد فقط نسبتِ بسته‌بندی‌اند (برای فرمولِ تبدیلِ نماینده)، نه مقدارِ موجودی —
        موجودیِ واقعی را از پایینِ همین کارت یا تبِ «ورود از اکسل» اضافه کنید.
      </p>
      {preview.length > 0 && (
        <p className="subtle" style={{ marginTop: "var(--sp-1)" }}>
          برای فرمولِ تبدیلِ نماینده: {preview.join("؛ ")}.
        </p>
      )}

      <label htmlFor={`de-${keyId}`} style={{ marginTop: "var(--sp-2)" }}>توضیحات</label>
      <textarea id={`de-${keyId}`} value={v.description} onChange={(e) => set({ description: e.target.value })}
                rows={3} placeholder="توضیحاتِ محصول برای نماینده و مشتری…" />
    </details>
  );
}
