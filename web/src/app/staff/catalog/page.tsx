"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import NavMenu from "../../NavMenu";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";
import { matches } from "@/lib/search";

type Product = {
  id: string; name: string; code: string;
  imageUrl: string | null; color: string | null; glaze: string | null; punch: string | null;
};

export default function CatalogPage() {
  const { ctx, state } = useContexts("staff");
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [urlDraft, setUrlDraft] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (tenantId: string) => {
    const res = await getJson<{ products: Product[] }>(`/api/products?tenantId=${tenantId}`);
    if (res.ok) { setProducts(res.data.products); setLoadErr(""); }
    else setLoadErr(loadError(res.status));
    setLoaded(true);
  }, []);

  useEffect(() => { if (ctx) load(ctx.tenantId); }, [ctx, load]);

  async function setImage(productId: string, imageUrl: string | null) {
    if (!ctx) return;
    setPending(productId); setMsg("");
    const res = await postJson("/api/products", { tenantId: ctx.tenantId, productId, imageUrl }, "PATCH");
    if (!res.ok) setMsg(actionError(res.status));
    else await load(ctx.tenantId);
    setPending(null);
  }

  async function upload(productId: string, file: File) {
    if (!ctx) return;
    setPending(productId); setMsg("");
    try {
      const form = new FormData();
      form.set("tenantId", ctx.tenantId);
      form.set("file", file);
      // آپلود چند-بخشی است، پس postJson (که JSON می‌فرستد) مناسب نیست
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) { setMsg(actionError(res.status)); return; }
      const { url } = await res.json();
      await setImage(productId, url); // همان مسیرِ تنظیمِ عکس
    } catch {
      setMsg("آپلود انجام نشد.");
    } finally { setPending(null); }
  }

  if (state === "none")
    return (
      <main>
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>این بخش فقط برای پشتیبان است.</span>
        </div>
      </main>
    );
  if (!ctx) return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;

  const visible = products.filter((p) => matches(query, [p.name, p.code]));
  const withImage = products.filter((p) => p.imageUrl).length;

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>کاتالوگ تصویری</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu /></nav>
      </div>

      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          عکسِ هر محصول به نماینده در صفحه‌ی سفارش نشان داده می‌شود. عکس را می‌توانید
          <strong> آپلود</strong> کنید یا <strong>URL</strong> بگذارید — یا در ستونِ
          «عکس» فایلِ اکسلِ ورودِ موجودی. {" "}
          <span className="num">{withImage.toLocaleString("fa-IR")}</span> از{" "}
          <span className="num">{products.length.toLocaleString("fa-IR")}</span> محصول عکس دارد.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      {msg && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{msg}</span></div>}

      {products.length > 6 && (
        <div className="row row--start" style={{ marginBottom: "var(--sp-3)" }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="جستجوی محصول…" aria-label="جستجو" style={{ maxWidth: 280 }} />
        </div>
      )}

      {loaded && products.length === 0 && <p className="empty">محصولی ثبت نشده.</p>}

      {visible.map((p) => (
        <div className="card" key={p.id}>
          <div className="lot-head">
            {p.imageUrl
              ? <span className="thumb"><img src={p.imageUrl} alt={p.name} loading="lazy" /></span>
              : <span className="thumb thumb--empty" aria-hidden="true"><Icon name="info" size={20} /></span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row">
                <strong>{p.name}</strong>
                <span className="subtle num">{p.code}</span>
              </div>

              <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
                {/* دو مسیر کنارِ هم: آپلودِ فایل، یا URL */}
                <label className="btn-file">
                  آپلود عکس
                  <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }}
                         disabled={pending === p.id}
                         onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(p.id, f); e.target.value = ""; }} />
                </label>
                {p.imageUrl && (
                  <button className="danger" disabled={pending === p.id}
                          onClick={() => setImage(p.id, null)}>حذف عکس</button>
                )}
                {pending === p.id && <span className="spinner" aria-hidden="true" />}
              </div>

              <div className="row row--start" style={{ marginTop: "var(--sp-2)" }}>
                <input value={urlDraft[p.id] ?? ""} placeholder="یا URL عکس را بگذارید"
                       onChange={(e) => setUrlDraft({ ...urlDraft, [p.id]: e.target.value })}
                       style={{ maxWidth: 260 }} aria-label={`URL عکس ${p.name}`} />
                <button className="ghost" disabled={pending === p.id || !(urlDraft[p.id]?.trim())}
                        onClick={() => { setImage(p.id, urlDraft[p.id].trim()); setUrlDraft({ ...urlDraft, [p.id]: "" }); }}>
                  ثبت URL
                </button>
              </div>
            </div>
          </div>
        </div>
      ))}
    </main>
  );
}
