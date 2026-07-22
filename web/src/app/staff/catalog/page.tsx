"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import NavMenu from "../../NavMenu";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";
import { matches } from "@/lib/search";

type Img = { id: string; url: string };
type Product = {
  id: string; name: string; code: string;
  imageUrl: string | null; color: string | null; glaze: string | null;
  punch: string | null; body: string | null;
  size: string | null; thickness: string | null; usageArea: string | null; description: string | null;
  images: Img[]; sku: string | null;
  variantId: string | null; hasStock: boolean; basePrice: number | null;
};
type Sub = {
  id: string; variantId: string; substituteVariantId: string;
  substituteName: string; substituteCode: string; note: string | null;
};

const money = (v: number) => v.toLocaleString("fa-IR");
const EMPTY_FORM = { name: "", code: "", sku: "", color: "", glaze: "", punch: "", body: "", size: "", thickness: "", usageArea: "", description: "", imageUrl: "" };
const EMPTY_EDIT = { name: "", color: "", glaze: "", punch: "", body: "", size: "", thickness: "", usageArea: "", description: "" };

export default function CatalogPage() {
  const { ctx, state } = useContexts("staff");
  const [products, setProducts] = useState<Product[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [subFor, setSubFor] = useState<string | null>(null);
  const [subPick, setSubPick] = useState("");
  const [subNote, setSubNote] = useState("");
  const [subQuery, setSubQuery] = useState("");
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [imgUrl, setImgUrl] = useState<Record<string, string>>({}); // URLِ درحال‌افزودن به گالریِ هر محصول

  const [form, setForm] = useState(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async (tenantId: string) => {
    const [p, s] = await Promise.all([
      getJson<{ products: Product[] }>(`/api/products?tenantId=${tenantId}`),
      getJson<{ items: Sub[] }>(`/api/substitutes?tenantId=${tenantId}`),
    ]);
    if (p.ok) setProducts(p.data.products);
    if (s.ok) setSubs(s.data.items);
    const failed = [p, s].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, []);

  useEffect(() => { if (ctx) load(ctx.tenantId); }, [ctx, load]);

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
      const code = res.status;
      setMsg(code === 409 ? "کد یا sku تکراری است." : code === 400 ? "نام، کد و sku الزامی‌اند." : actionError(code));
    } else {
      setForm(EMPTY_FORM);
      setMsg("محصول ساخته شد.");
      await load(ctx.tenantId);
    }
    setPending(null);
  }

  // --- گالری --------------------------------------------------------------
  async function galleryOp(url: string, body: object, method: "POST" | "PATCH" | "DELETE") {
    if (!ctx) return;
    setPending("img" + url); setMsg("");
    const res = await postJson("/api/product-images", { tenantId: ctx.tenantId, ...body }, method);
    if (!res.ok) setMsg(actionError(res.status));
    else await load(ctx.tenantId);
    setPending(null);
  }
  const addImg = (productId: string, url: string) => url.trim() && galleryOp(productId, { productId, url }, "POST");
  const setPrimaryImg = (imageId: string) => galleryOp(imageId, { imageId }, "PATCH");
  const removeImg = (imageId: string) => galleryOp(imageId, { imageId }, "DELETE");

  function startEdit(p: Product) {
    setEditFor(p.id);
    setEditForm({
      name: p.name, color: p.color ?? "", glaze: p.glaze ?? "", punch: p.punch ?? "", body: p.body ?? "",
      size: p.size ?? "", thickness: p.thickness ?? "", usageArea: p.usageArea ?? "", description: p.description ?? "",
    });
    setSubFor(null); setMsg("");
  }

  async function saveEdit(productId: string) {
    if (!ctx || !editForm.name.trim()) return;
    setPending("edit" + productId); setMsg("");
    const res = await postJson("/api/products", { tenantId: ctx.tenantId, productId, ...editForm }, "PATCH");
    if (!res.ok) setMsg(actionError(res.status));
    else { setEditFor(null); setMsg("محصول ویرایش شد."); await load(ctx.tenantId); }
    setPending(null);
  }

  async function addSub(variantId: string) {
    if (!ctx || !subPick) return;
    setPending("sub" + variantId); setMsg("");
    const res = await postJson("/api/substitutes",
      { tenantId: ctx.tenantId, variantId, substituteVariantId: subPick, note: subNote });
    if (!res.ok) setMsg(actionError(res.status));
    else { setSubPick(""); setSubNote(""); await load(ctx.tenantId); }
    setPending(null);
  }

  async function removeSub(id: string) {
    if (!ctx) return;
    setPending("subdel" + id); setMsg("");
    const res = await postJson("/api/substitutes", { tenantId: ctx.tenantId, id }, "DELETE");
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

  // فیلدهای «اطلاعاتِ بیشتر» — در فرمِ ساخت و ویرایش مشترک‌اند
  const moreFields = (v: typeof EMPTY_EDIT, set: (patch: Partial<typeof EMPTY_EDIT>) => void, key: string) => (
    <details className="more-info">
      <summary>اطلاعاتِ بیشتر (اختیاری) — ابعاد، ضخامت، کاربری، توضیحات</summary>
      <div className="grid2" style={{ marginTop: "var(--sp-2)" }}>
        <div><label htmlFor={`sz-${key}`}>ابعاد</label>
          <input id={`sz-${key}`} value={v.size} onChange={(e) => set({ size: e.target.value })} placeholder="۶۰×۶۰" /></div>
        <div><label htmlFor={`th-${key}`}>ضخامت</label>
          <input id={`th-${key}`} value={v.thickness} onChange={(e) => set({ thickness: e.target.value })} placeholder="۹ میلی‌متر" /></div>
        <div><label htmlFor={`ua-${key}`}>کاربری</label>
          <input id={`ua-${key}`} value={v.usageArea} onChange={(e) => set({ usageArea: e.target.value })} placeholder="کف / دیوار / نما" /></div>
      </div>
      <label htmlFor={`de-${key}`} style={{ marginTop: "var(--sp-2)" }}>توضیحات</label>
      <textarea id={`de-${key}`} value={v.description} onChange={(e) => set({ description: e.target.value })}
                rows={3} placeholder="توضیحاتِ محصول برای نماینده و مشتری…" />
    </details>
  );

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
          محصول را همین‌جا بسازید (با عکس)، یا دسته‌جمعی از فایلِ اکسل. هر محصول می‌تواند
          <strong> گالریِ چند عکسی</strong> داشته باشد؛ عکسِ <strong>اصلی</strong> همان تامنیلی است که
          همه‌جا دیده می‌شود. جایگزین و اطلاعاتِ بیشتر (ابعاد/توضیحات) هم همین‌جا.
          {" "}<span className="num">{withImage.toLocaleString("fa-IR")}</span> از{" "}
          <span className="num">{products.length.toLocaleString("fa-IR")}</span> محصول عکس دارد.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      {msg && (
        <div className={`banner banner--${msg.startsWith("محصول") ? "ok" : "error"}`} role="status">
          <Icon name={msg.startsWith("محصول") ? "check" : "alert"} /><span>{msg}</span>
        </div>
      )}

      <h2>محصول جدید</h2>
      <div className="card">
        <div className="lot-head">
          <div>
            {form.imageUrl
              ? <span className="thumb"><img src={form.imageUrl} alt="پیش‌نمایش" /></span>
              : <span className="thumb thumb--empty" aria-hidden="true"><Icon name="info" size={20} /></span>}
            <label className="btn-file" style={{ marginTop: "var(--sp-2)", width: 88, fontSize: ".8rem", padding: ".4rem" }}>
              {uploading ? "…" : "عکس اصلی"}
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
              <div><label htmlFor="pu">یا URL عکس اصلی</label>
                <input id="pu" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://…" /></div>
            </div>
            {moreFields(form, (patch) => setForm((s) => ({ ...s, ...patch })), "new")}
            <button className="primary" onClick={createProduct} aria-busy={pending === "create"}
              disabled={pending === "create" || !ready}
              style={{ width: "100%", marginTop: "var(--sp-4)" }}>
              {pending === "create" && <span className="spinner" aria-hidden="true" />}افزودن محصول
            </button>
            <p className="subtle" style={{ marginTop: "var(--sp-2)" }}>عکس‌های بیشترِ گالری را بعد از ساخت، از روی کارتِ محصول اضافه کنید.</p>
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
              ? <span className="thumb"><img src={p.imageUrl} alt={p.name} loading="lazy" /></span>
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

              <div className="muted" style={{ marginTop: "var(--sp-1)" }}>
                {p.basePrice !== null
                  ? <>قیمتِ پایه: <span className="metric">{money(p.basePrice)}</span> ریال / کارتن</>
                  : <span className="subtle">قیمتی ثبت نشده</span>}
                {" · "}
                <Link href="/staff/prices" className="subtle">ویرایش قیمت ←</Link>
              </div>

              {/* گالری: اولی = اصلی (تامنیل). کلیک روی ★ = اصلی‌کردن، × = حذف. */}
              <div className="gallery" style={{ marginTop: "var(--sp-3)" }}>
                {p.images.map((img, i) => (
                  <div key={img.id} className={`gallery-item ${i === 0 ? "gallery-item--primary" : ""}`}>
                    <img src={img.url} alt="" loading="lazy" />
                    {i === 0
                      ? <span className="gallery-badge">اصلی</span>
                      : <button className="gallery-star" title="عکسِ اصلی شود" aria-label="عکسِ اصلی شود"
                          disabled={pending === "img" + img.id} onClick={() => setPrimaryImg(img.id)}>★</button>}
                    <button className="gallery-del" title="حذف عکس" aria-label="حذف عکس"
                      disabled={pending === "img" + img.id} onClick={() => removeImg(img.id)}>×</button>
                  </div>
                ))}
                <label className="gallery-add btn-file" title="افزودن عکس به گالری">
                  <Icon name="info" size={16} /><span style={{ fontSize: ".7rem" }}>+ عکس</span>
                  <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }}
                    disabled={pending === "img" + p.id}
                    onChange={async (e) => {
                      const f = e.target.files?.[0]; e.target.value = "";
                      if (!f) return;
                      setPending("img" + p.id);
                      const url = await uploadFile(f);
                      setPending(null);
                      if (url) await addImg(p.id, url);
                    }} />
                </label>
              </div>
              {/* افزودن با URL */}
              <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-2)" }}>
                <input value={imgUrl[p.id] ?? ""} onChange={(e) => setImgUrl({ ...imgUrl, [p.id]: e.target.value })}
                  placeholder="یا URL عکس…" aria-label="افزودن عکس با URL" style={{ maxWidth: 240, direction: "ltr" }} />
                <button className="ghost" disabled={!imgUrl[p.id]?.trim() || pending === "img" + (imgUrl[p.id] ?? "")}
                  onClick={async () => { await addImg(p.id, imgUrl[p.id] ?? ""); setImgUrl({ ...imgUrl, [p.id]: "" }); }}>افزودن</button>
              </div>

              <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
                <button className="ghost" onClick={() => (editFor === p.id ? setEditFor(null) : startEdit(p))}>
                  {editFor === p.id ? "بستن ویرایش" : "ویرایش"}
                </button>
                {p.variantId && (
                  <button className="ghost"
                    onClick={() => { setSubFor(subFor === p.variantId ? null : p.variantId); setSubPick(""); setSubNote(""); setSubQuery(""); }}>
                    جایگزین‌ها ({money(subs.filter((s) => s.variantId === p.variantId).length)})
                  </button>
                )}
                {pending === "edit" + p.id && <span className="spinner" aria-hidden="true" />}
              </div>

              {editFor === p.id && (
                <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
                  <div className="grid2">
                    <div><label htmlFor={`en-${p.id}`}>نام *</label>
                      <input id={`en-${p.id}`} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
                    <div><label>کد <span className="subtle">(قفل)</span></label>
                      <input value={p.code} disabled aria-label="کد (غیرقابل ویرایش)" /></div>
                    <div><label>sku <span className="subtle">(قفل)</span></label>
                      <input value={p.sku ?? ""} disabled aria-label="sku (غیرقابل ویرایش)" /></div>
                    <div><label htmlFor={`ec-${p.id}`}>رنگ</label>
                      <input id={`ec-${p.id}`} value={editForm.color} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} /></div>
                    <div><label htmlFor={`eg-${p.id}`}>لعاب</label>
                      <input id={`eg-${p.id}`} value={editForm.glaze} onChange={(e) => setEditForm({ ...editForm, glaze: e.target.value })} /></div>
                    <div><label htmlFor={`ep-${p.id}`}>پانچ</label>
                      <input id={`ep-${p.id}`} value={editForm.punch} onChange={(e) => setEditForm({ ...editForm, punch: e.target.value })} /></div>
                    <div><label htmlFor={`eb-${p.id}`}>بدنه</label>
                      <input id={`eb-${p.id}`} value={editForm.body} onChange={(e) => setEditForm({ ...editForm, body: e.target.value })} /></div>
                  </div>
                  {moreFields(editForm, (patch) => setEditForm((s) => ({ ...s, ...patch })), p.id)}
                  <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
                    <button className="primary" disabled={pending === "edit" + p.id || !editForm.name.trim()}
                      onClick={() => saveEdit(p.id)}>
                      {pending === "edit" + p.id && <span className="spinner" aria-hidden="true" />}ذخیره
                    </button>
                    <button className="ghost" onClick={() => setEditFor(null)}>انصراف</button>
                  </div>
                </div>
              )}

              {p.variantId && subFor === p.variantId && (
                <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
                  <div className="subtle" style={{ marginBottom: "var(--sp-2)" }}>
                    اگر <strong>{p.name}</strong> نبود, این‌ها پیشنهاد می‌شوند (فقط موجودها به نماینده می‌روند):
                  </div>
                  {subs.filter((s) => s.variantId === p.variantId).map((s) => (
                    <div className="row" key={s.id} style={{ marginBottom: "var(--sp-1)" }}>
                      <span>{s.substituteName} <span className="subtle num">{s.substituteCode}</span>
                        {s.note ? <span className="subtle"> — {s.note}</span> : null}</span>
                      <button className="danger" disabled={pending === "subdel" + s.id}
                        onClick={() => removeSub(s.id)}>حذف</button>
                    </div>
                  ))}
                  {(() => {
                    const cands = products.filter((o) => o.variantId && o.variantId !== p.variantId
                      && !subs.some((s) => s.variantId === p.variantId && s.substituteVariantId === o.variantId)
                      && matches(subQuery, [o.name, o.code]));
                    return (
                      <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-2)" }}>
                        <input type="search" value={subQuery} onChange={(e) => setSubQuery(e.target.value)}
                          placeholder="جستجوی نام یا کد…" aria-label="جستجوی جایگزین" style={{ maxWidth: 180 }} />
                        <select value={subPick} onChange={(e) => setSubPick(e.target.value)} aria-label="کالای جایگزین" style={{ maxWidth: 240 }}>
                          <option value="">{cands.length ? "انتخاب جایگزین…" : "موردی یافت نشد"}</option>
                          {cands.map((o) => <option key={o.variantId} value={o.variantId!}>{o.name} ({o.code})</option>)}
                        </select>
                        <input value={subNote} onChange={(e) => setSubNote(e.target.value)}
                          placeholder="توضیح (اختیاری)" style={{ maxWidth: 200 }} aria-label="توضیح جایگزین" />
                        <button className="primary" disabled={pending === "sub" + p.variantId || !subPick}
                          onClick={() => addSub(p.variantId!)}>افزودن جایگزین</button>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </main>
  );
}
