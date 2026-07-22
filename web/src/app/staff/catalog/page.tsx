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
  imageUrl: string | null; color: string | null; glaze: string | null;
  punch: string | null; body: string | null; sku: string | null; hasStock: boolean;
};

export default function CatalogPage() {
  const { ctx, state } = useContexts("staff");
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  // فرمِ محصولِ جدید — عکس همین‌جا انتخاب می‌شود، نه در بخشِ جدا
  const [form, setForm] = useState({ name: "", code: "", sku: "", color: "", glaze: "", punch: "", body: "", imageUrl: "" });
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async (tenantId: string) => {
    const res = await getJson<{ products: Product[] }>(`/api/products?tenantId=${tenantId}`);
    if (res.ok) { setProducts(res.data.products); setLoadErr(""); }
    else setLoadErr(loadError(res.status));
    setLoaded(true);
  }, []);

  useEffect(() => { if (ctx) load(ctx.tenantId); }, [ctx, load]);

  /** آپلودِ فایل → URL. برای فرمِ جدید و کارتِ ویرایش مشترک است. */
  async function uploadFile(file: File): Promise<string | null> {
    if (!ctx) return null;
    const fd = new FormData();
    fd.set("tenantId", ctx.tenantId); fd.set("file", file);
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    if (!res.ok) { setMsg(actionError(res.status)); return null; }
    return (await res.json()).url as string;
  }

  async function createProduct() {
    if (!ctx || !form.name.trim() || !form.code.trim() || !form.sku.trim()) return;
    setPending("create"); setMsg("");
    const res = await postJson("/api/products", { tenantId: ctx.tenantId, ...form });
    if (!res.ok) {
      // ۴۰۹ = کد/sku تکراری، ۴۰۰ = فیلدِ الزامیِ خالی
      const code = res.status;
      setMsg(code === 409 ? "کد یا sku تکراری است." : code === 400 ? "نام، کد و sku الزامی‌اند." : actionError(code));
    } else {
      setForm({ name: "", code: "", sku: "", color: "", glaze: "", punch: "", body: "", imageUrl: "" });
      setMsg("محصول ساخته شد.");
      await load(ctx.tenantId);
    }
    setPending(null);
  }

  async function setImage(productId: string, imageUrl: string | null) {
    if (!ctx) return;
    setPending(productId); setMsg("");
    const res = await postJson("/api/products", { tenantId: ctx.tenantId, productId, imageUrl }, "PATCH");
    if (!res.ok) setMsg(actionError(res.status));
    else await load(ctx.tenantId);
    setPending(null);
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

  const visible = products.filter((p) => matches(query, [p.name, p.code, p.color, p.glaze, p.punch]));
  const withImage = products.filter((p) => p.imageUrl).length;
  const ready = form.name.trim() && form.code.trim() && form.sku.trim();

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>مدیریت محصول</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu /></nav>
      </div>

      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          محصول را همین‌جا بسازید (با عکس)، یا دسته‌جمعی از فایلِ اکسلِ ورودِ موجودی —
          اگر ستونِ <strong>نام</strong> در فایل باشد، محصولِ ناموجود خودکار ساخته می‌شود.
          عکسِ هر محصول به نماینده در صفحه‌ی سفارش نشان داده می‌شود.
          {" "}<span className="num">{withImage.toLocaleString("fa-IR")}</span> از{" "}
          <span className="num">{products.length.toLocaleString("fa-IR")}</span> محصول عکس دارد.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      {msg && (
        <div className={`banner banner--${msg.includes("ساخته شد") ? "ok" : "error"}`} role="status">
          <Icon name={msg.includes("ساخته شد") ? "check" : "alert"} /><span>{msg}</span>
        </div>
      )}

      <h2>محصول جدید</h2>
      <div className="card">
        <div className="lot-head">
          {/* عکس در همان فرم: پیش‌نمایش + آپلود، کنارِ فیلدهای اطلاعات */}
          <div>
            {form.imageUrl
              ? <span className="thumb"><img src={form.imageUrl} alt="پیش‌نمایش" /></span>
              : <span className="thumb thumb--empty" aria-hidden="true"><Icon name="info" size={20} /></span>}
            <label className="btn-file" style={{ marginTop: "var(--sp-2)", width: 88, fontSize: ".8rem", padding: ".4rem" }}>
              {uploading ? "…" : "عکس"}
              <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }}
                disabled={uploading}
                onChange={async (e) => {
                  const f = e.target.files?.[0]; e.target.value = "";
                  if (!f) return;
                  setUploading(true);
                  const url = await uploadFile(f);
                  if (url) setForm((s) => ({ ...s, imageUrl: url }));
                  setUploading(false);
                }} />
            </label>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="grid2">
              <div><label htmlFor="pn">نام *</label>
                <input id="pn" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="تسلا طوسی" /></div>
              <div><label htmlFor="pc">کد *</label>
                <input id="pc" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="TS-6060" /></div>
              <div><label htmlFor="ps">sku * <span className="subtle">(کلیدِ تطبیق با اکسل)</span></label>
                <input id="ps" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="TS-6060-A" /></div>
              <div><label htmlFor="pcl">رنگ</label>
                <input id="pcl" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} placeholder="طوسی" /></div>
              <div><label htmlFor="pg">لعاب</label>
                <input id="pg" value={form.glaze} onChange={(e) => setForm({ ...form, glaze: e.target.value })} placeholder="مات / ترانس" /></div>
              <div><label htmlFor="pp">پانچ</label>
                <input id="pp" value={form.punch} onChange={(e) => setForm({ ...form, punch: e.target.value })} placeholder="تخت / رستیک" /></div>
              <div><label htmlFor="pb">بدنه</label>
                <input id="pb" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="سفید / قرمز" /></div>
              <div><label htmlFor="pu">یا URL عکس</label>
                <input id="pu" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://…" /></div>
            </div>
            <button className="primary" onClick={createProduct} aria-busy={pending === "create"}
              disabled={pending === "create" || !ready}
              style={{ width: "100%", marginTop: "var(--sp-4)" }}>
              {pending === "create" && <span className="spinner" aria-hidden="true" />}افزودن محصول
            </button>
          </div>
        </div>
      </div>

      <h2>محصولات</h2>
      {products.length > 6 && (
        <div className="row row--start" style={{ marginBottom: "var(--sp-3)" }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجوی محصول…" aria-label="جستجو" style={{ maxWidth: 280 }} />
        </div>
      )}
      {loaded && products.length === 0 && <p className="empty">هنوز محصولی ساخته نشده.</p>}

      {visible.map((p) => (
        <div className="card" key={p.id}>
          <div className="lot-head">
            {p.imageUrl
              ? <button className="thumb" onClick={() => setImage(p.id, null)} aria-label="حذف عکس" title="کلیک = حذف عکس"><img src={p.imageUrl} alt={p.name} loading="lazy" /></button>
              : <span className="thumb thumb--empty" aria-hidden="true"><Icon name="info" size={20} /></span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row">
                <strong>{p.name}</strong>
                <span>
                  <span className="subtle num">{p.code}</span>
                  {!p.hasStock && <span className="badge badge--warn" style={{ marginInlineStart: ".4rem" }}>بدون موجودی</span>}
                </span>
              </div>
              <div className="subtle">
                {[p.color, p.glaze, p.punch, p.body].filter(Boolean).join(" · ") || "بدون ویژگی"}
                {p.sku ? ` · sku: ${p.sku}` : ""}
              </div>
              <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
                <label className="btn-file">
                  {p.imageUrl ? "تغییر عکس" : "افزودن عکس"}
                  <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }}
                    disabled={pending === p.id}
                    onChange={async (e) => {
                      const f = e.target.files?.[0]; e.target.value = "";
                      if (!f) return;
                      setPending(p.id);
                      const url = await uploadFile(f);
                      setPending(null);
                      if (url) await setImage(p.id, url);
                    }} />
                </label>
                {pending === p.id && <span className="spinner" aria-hidden="true" />}
              </div>
            </div>
          </div>
        </div>
      ))}
    </main>
  );
}
