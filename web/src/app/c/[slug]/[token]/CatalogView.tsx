"use client";
import { useEffect, useRef, useState } from "react";
import type { PublicItem } from "@/db/sharedCatalog";
import { hideOnError } from "@/lib/img";

// نمای کاتالوگِ مشتری: گرید + پاپ‌آپِ گالری/جزئیات. کلاینت چون کلیک و مودال لازم دارد.
const money = (v: number) => v.toLocaleString("fa-IR");

export default function CatalogView({ items }: { items: PublicItem[] }) {
  const [open, setOpen] = useState<PublicItem | null>(null);
  const [idx, setIdx] = useState(0);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const show = (it: PublicItem) => { setOpen(it); setIdx(0); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // فوکوس روی دکمه‌ی بستن — همان الگویِ /reserve و NavMenu؛ این صفحه را مشتریِ
  // بدونِ‌لاگین هم می‌بیند، پس دسترسی‌پذیریِ کیبورد اینجا مهم‌تر هم هست.
  useEffect(() => { if (open) closeBtnRef.current?.focus(); }, [open]);

  const gallery = (it: PublicItem) => it.images.length ? it.images.map((i) => i.url) : it.imageUrl ? [it.imageUrl] : [];
  const specs = (it: PublicItem) => [it.color, it.glaze, it.punch, it.body].filter(Boolean).join(" · ");

  return (
    <>
      <div className="catalog-grid">
        {items.map((it) => (
          <button className="card catalog-card" key={it.code} style={{ margin: 0 }} onClick={() => show(it)}
                  aria-label={`جزئیاتِ ${it.name}`}>
            {it.imageUrl
              ? <img onError={hideOnError} src={it.imageUrl} alt={it.name} loading="lazy" className="catalog-img" />
              : <div className="catalog-img catalog-img--empty" aria-hidden="true" />}
            <div style={{ marginTop: "var(--sp-2)" }}>
              <div className="row">
                <strong>{it.name}</strong>
                <span className={`badge ${it.inStock ? "badge--ok" : "badge--warn"}`}>{it.inStock ? "موجود" : "ناموجود"}</span>
              </div>
              <div className="subtle num">{it.code}</div>
              {specs(it) && <div className="subtle" style={{ marginTop: "var(--sp-1)" }}>{specs(it)}</div>}
              {it.customerPrice != null && (
                <div className="muted" style={{ marginTop: "var(--sp-1)" }}>
                  <span className="metric">{money(it.customerPrice)}</span> ریال / مترمربع
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {open && (() => {
        const g = gallery(open);
        const main = g[idx] ?? g[0];
        return (
          <div className="modal-backdrop" onClick={() => setOpen(null)} role="dialog" aria-modal="true"
               aria-label={`جزئیاتِ ${open.name}`}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="row">
                <strong>{open.name}</strong>
                <button ref={closeBtnRef} className="ghost" onClick={() => setOpen(null)} aria-label="بستن">✕</button>
              </div>
              {main && <img onError={hideOnError} src={main} alt={open.name} className="modal-img" />}
              {g.length > 1 && (
                <div className="gallery" style={{ marginTop: "var(--sp-2)" }}>
                  {g.map((u, i) => (
                    <button key={i} className={`gallery-item ${i === idx ? "gallery-item--primary" : ""}`}
                            onClick={() => setIdx(i)} aria-label={`عکس ${i + 1}`}>
                      <img onError={hideOnError} src={u} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
              <div className="stack" style={{ marginTop: "var(--sp-3)" }}>
                <div className="row"><span className="muted">کد</span><span className="num">{open.code}</span></div>
                <div className="row"><span className="muted">وضعیت</span>
                  <span className={`badge ${open.inStock ? "badge--ok" : "badge--warn"}`}>{open.inStock ? "موجود" : "ناموجود"}</span></div>
                {open.color && <div className="row"><span className="muted">رنگ</span><span>{open.color}</span></div>}
                {open.glaze && <div className="row"><span className="muted">لعاب</span><span>{open.glaze}</span></div>}
                {open.punch && <div className="row"><span className="muted">پانچ</span><span>{open.punch}</span></div>}
                {open.body && <div className="row"><span className="muted">بدنه</span><span>{open.body}</span></div>}
                {open.size && <div className="row"><span className="muted">ابعاد</span><span>{open.size}</span></div>}
                {open.thickness && <div className="row"><span className="muted">ضخامت</span><span>{open.thickness}</span></div>}
                {open.usageArea && <div className="row"><span className="muted">کاربری</span><span>{open.usageArea}</span></div>}
                {open.customerPrice != null && (
                  <div className="row"><span className="muted">قیمت</span>
                    <span className="metric">{money(open.customerPrice)} ریال / مترمربع</span></div>
                )}
              </div>
              {open.description && (
                <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
                  <div className="muted" style={{ marginBottom: "var(--sp-1)" }}>توضیحات</div>
                  <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{open.description}</p>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </>
  );
}
