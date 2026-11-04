"use client";
import { useEffect, useId, useRef, useState } from "react";
import { getJson, loadError } from "@/lib/api";

export type CustomerOption = { id: string; name: string };

/**
 * جست‌وجو/انتخابِ مشتری برای فرمِ ساختِ حواله — از GET /api/customers موجود
 * می‌خواند (tenant/permission همان‌جا چک می‌شود)، customerId نگه می‌دارد نه فقط نام
 * (spec ۳.۵: customerName فقط برای caller قدیمی‌ست، این‌جا شناسه‌ی واقعی می‌رود).
 */
export default function CustomerPicker({
  tenantId, value, onChange,
}: {
  tenantId: string;
  value: CustomerOption | null;
  onChange: (c: CustomerOption | null) => void;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function search(v: string) {
    setQ(v);
    setOpen(true);
    setErr("");
    if (debounce.current) clearTimeout(debounce.current);
    const myGen = ++gen.current;
    debounce.current = setTimeout(async () => {
      setLoading(true);
      const res = await getJson<{ customers: CustomerOption[] }>(
        `/api/customers?tenantId=${tenantId}&q=${encodeURIComponent(v)}`);
      if (myGen !== gen.current) return; // جست‌وجوی تازه‌تری از این جلو زده
      setLoading(false);
      if (res.ok) { setOptions(res.data.customers); setActiveIdx(-1); }
      else setErr(loadError(res.status));
    }, 300);
  }

  function pick(c: CustomerOption) {
    onChange(c);
    setQ("");
    setOpen(false);
    setOptions([]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || options.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (activeIdx >= 0) pick(options[activeIdx]); }
    else if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="field" ref={boxRef} style={{ position: "relative", margin: 0 }}>
      <label htmlFor={id}>مشتری (اختیاری)</label>
      {value ? (
        <div className="row row--start" style={{ gap: "var(--sp-2)" }}>
          <strong>{value.name}</strong>
          <button type="button" className="ghost" onClick={() => onChange(null)}>حذفِ انتخاب</button>
        </div>
      ) : (
        <>
          <input id={id} type="text" role="combobox" aria-expanded={open}
            aria-autocomplete="list" aria-controls={`${id}-list`}
            placeholder="جست‌وجوی مشتری…" value={q} autoComplete="off"
            onChange={(e) => search(e.target.value)} onFocus={() => q && setOpen(true)}
            onKeyDown={onKeyDown} />
          {open && (
            <div id={`${id}-list`} role="listbox" className="card"
              style={{ position: "absolute", zIndex: 10, right: 0, left: 0, marginTop: 2, padding: "var(--sp-2)" }}>
              {loading && <p className="muted"><span className="spinner" /> در حال جست‌وجو…</p>}
              {!loading && err && <p className="err">{err}</p>}
              {!loading && !err && options.length === 0 && q && <p className="empty">مشتری‌ای پیدا نشد.</p>}
              {!loading && options.map((c, i) => (
                <div key={c.id} role="option" aria-selected={i === activeIdx}
                  style={{
                    padding: "var(--sp-1) var(--sp-2)", cursor: "pointer", borderRadius: "var(--radius-sm)",
                    background: i === activeIdx ? "var(--surface-sunken)" : undefined,
                  }}
                  onMouseEnter={() => setActiveIdx(i)} onClick={() => pick(c)}>
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
