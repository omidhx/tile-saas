"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import { hasPageAccess } from "@/lib/staffPages";
import NavMenu from "../../NavMenu";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";
import { matches, normalize } from "@/lib/search";
import { hideOnError } from "@/lib/img";

type Img = { id: string; url: string };
type Product = {
  id: string; name: string; code: string;
  imageUrl: string | null; color: string | null; glaze: string | null;
  punch: string | null; body: string | null;
  size: string | null; thickness: string | null; usageArea: string | null; description: string | null;
  images: Img[]; sku: string | null;
  variantId: string | null; hasStock: boolean; basePrice: number | null;
  /** بسته‌بندیِ فیزیکی — پایه‌ی تبدیلِ کارتن⇄پالت⇄مترمربع در صفحه‌ی سفارشِ نماینده. */
  boxesPerPallet: number | null; sqcmPerBox: number | null;
};
type Sub = {
  id: string; variantId: string; substituteVariantId: string;
  substituteName: string; substituteCode: string; note: string | null;
};

const money = (v: number) => v.toLocaleString("fa-IR");
const sqm = (cm2: number) => (cm2 / 10000).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
const EMPTY_FORM = { name: "", code: "", sku: "", color: "", glaze: "", punch: "", body: "", size: "", thickness: "", usageArea: "", description: "", imageUrl: "", boxesPerPallet: "", sqmPerBox: "" };
const EMPTY_EDIT = { name: "", color: "", glaze: "", punch: "", body: "", size: "", thickness: "", usageArea: "", description: "", boxesPerPallet: "", sqmPerBox: "" };

/** ورودیِ عددیِ اختیاری (ارقامِ فارسی هم می‌پذیرد): خالی=null (معتبر)، وگرنه باید عددِ صحیحِ مثبت باشد. */
function parsePackInt(s: string): { ok: true; value: number | null } | { ok: false } {
  if (!s.trim()) return { ok: true, value: null };
  const n = Number(normalize(s).replace(/[^0-9]/g, ""));
  return Number.isInteger(n) && n > 0 ? { ok: true, value: n } : { ok: false };
}
/** مثلِ parsePackInt ولی اعشاری (متراژ) — نقطه هم مجاز است. */
function parsePackNum(s: string): { ok: true; value: number | null } | { ok: false } {
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
function QuickPick({ label, options, onPick }: { label: string; options: string[]; onPick: (v: string) => void }) {
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
    // اعتبارسنجیِ بسته‌بندی همین‌جا — وگرنه ۴۰۰ سرور با «نام/کد/sku» اشتباه گرفته می‌شود
    // (هر دو یک کدِ وضعیت دارند و postJson بدنه‌ی خطا را برنمی‌گرداند).
    const bpp = parsePackInt(form.boxesPerPallet);
    const spb = parsePackNum(form.sqmPerBox);
    if (!bpp.ok || !spb.ok) { setMsg("تعداد کارتن در پالت یا متراژِ هر کارتن نامعتبر است."); return; }
    setPending("create"); setMsg("");
    const res = await postJson("/api/products", {
      tenantId: ctx.tenantId, ...form,
      boxesPerPallet: bpp.value, sqcmPerBox: spb.value != null ? Math.round(spb.value * 10000) : null,
    });
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

  // --- گالری ----------------------------------------------------------------
  // pendingِ همه‌ی عملیاتِ گالری با کلیدِ خودِ محصول است، نه عکس — تا حینِ یک
  // عملیات (مثلاً آپلود)، بقیه‌ی دکمه‌های گالریِ همان محصول هم غیرفعال شوند و دو
  // درخواستِ هم‌زمان روی یک محصول race نسازند.
  async function galleryOp(productId: string, body: object, method: "POST" | "PATCH" | "DELETE") {
    if (!ctx) return;
    setPending("img" + productId); setMsg("");
    const res = await postJson("/api/product-images", { tenantId: ctx.tenantId, ...body }, method);
    if (!res.ok) setMsg(actionError(res.status));
    else await load(ctx.tenantId);
    setPending(null);
  }
  function addImg(product: Product, url: string) {
    const clean = url.trim();
    if (!clean) return;
    // چکِ تکراری سمتِ کلاینت: بک‌اند idempotent است (کاری نمی‌کند) ولی بدونِ این
    // چک کاربر فکر می‌کند دکمه کار نکرده، چون هیچ خطا یا تغییری نمی‌بیند.
    if (product.images.some((img) => img.url === clean)) { setMsg("این عکس قبلاً در گالری هست."); return; }
    galleryOp(product.id, { productId: product.id, url: clean }, "POST");
  }
  const setPrimaryImg = (productId: string, imageId: string) => galleryOp(productId, { imageId }, "PATCH");
  const removeImg = (productId: string, imageId: string) => galleryOp(productId, { imageId }, "DELETE");

  function startEdit(p: Product) {
    setEditFor(p.id);
    setEditForm({
      name: p.name, color: p.color ?? "", glaze: p.glaze ?? "", punch: p.punch ?? "", body: p.body ?? "",
      size: p.size ?? "", thickness: p.thickness ?? "", usageArea: p.usageArea ?? "", description: p.description ?? "",
      boxesPerPallet: p.boxesPerPallet != null ? String(p.boxesPerPallet) : "",
      sqmPerBox: p.sqcmPerBox != null ? String(p.sqcmPerBox / 10000) : "",
    });
    setSubFor(null); setMsg("");
  }

  async function saveEdit(p: Product) {
    if (!ctx || !editForm.name.trim()) return;
    const bpp = parsePackInt(editForm.boxesPerPallet);
    const spb = parsePackNum(editForm.sqmPerBox);
    if (!bpp.ok || !spb.ok) { setMsg("تعداد کارتن در پالت یا متراژِ هر کارتن نامعتبر است."); return; }
    setPending("edit" + p.id); setMsg("");
    const res = await postJson("/api/products", {
      tenantId: ctx.tenantId, productId: p.id, ...editForm, variantId: p.variantId ?? undefined,
      boxesPerPallet: bpp.value, sqcmPerBox: spb.value != null ? Math.round(spb.value * 10000) : null,
    }, "PATCH");
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
  if (ctx.role === "staff" && !hasPageAccess(ctx.allowedPages, "catalog"))
    return <main><div className="banner banner--error" role="alert"><Icon name="alert" /><span>دسترسیِ این بخش برایت باز نیست — از مدیر بخواه اضافه‌اش کند.</span></div></main>;

  const visible = products.filter((p) => matches(query, [p.name, p.code, p.color, p.glaze, p.punch]));
  const withImage = products.filter((p) => p.imageUrl).length;
  const ready = form.name.trim() && form.code.trim() && form.sku.trim();

  // مقدارهای یکتای هر فیلدِ توصیفی، از خودِ محصولاتِ موجود — پایه‌ی QuickPick
  type AttrKey = "color" | "glaze" | "punch" | "body" | "size" | "thickness" | "usageArea";
  const distinctVal = (key: AttrKey) =>
    [...new Set(products.map((p) => p[key]).filter((v): v is string => !!v))].sort();

  // فیلدهای رنگ/لعاب/پانچ/بدنه + QuickPick — در فرمِ ساخت و ویرایش مشترک‌اند
  const attrFields = (v: typeof EMPTY_EDIT, set: (patch: Partial<typeof EMPTY_EDIT>) => void, key: string) => (
    <div className="grid2">
      <div><label htmlFor={`cl-${key}`}>رنگ</label>
        <input id={`cl-${key}`} value={v.color} onChange={(e) => set({ color: e.target.value })} placeholder="طوسی" />
        <QuickPick label="رنگ" options={distinctVal("color")} onPick={(val) => set({ color: val })} /></div>
      <div><label htmlFor={`gl-${key}`}>لعاب</label>
        <input id={`gl-${key}`} value={v.glaze} onChange={(e) => set({ glaze: e.target.value })} placeholder="مات / ترانس" />
        <QuickPick label="لعاب" options={distinctVal("glaze")} onPick={(val) => set({ glaze: val })} /></div>
      <div><label htmlFor={`pn-${key}`}>پانچ</label>
        <input id={`pn-${key}`} value={v.punch} onChange={(e) => set({ punch: e.target.value })} placeholder="تخت / رستیک" />
        <QuickPick label="پانچ" options={distinctVal("punch")} onPick={(val) => set({ punch: val })} /></div>
      <div><label htmlFor={`bd-${key}`}>بدنه</label>
        <input id={`bd-${key}`} value={v.body} onChange={(e) => set({ body: e.target.value })} placeholder="سفید / قرمز" />
        <QuickPick label="بدنه" options={distinctVal("body")} onPick={(val) => set({ body: val })} /></div>
    </div>
  );

  // فیلدهای «اطلاعاتِ بیشتر» — در فرمِ ساخت و ویرایش مشترک‌اند
  const moreFields = (v: typeof EMPTY_EDIT, set: (patch: Partial<typeof EMPTY_EDIT>) => void, key: string) => {
    // پیش‌نمایشِ زنده‌ی فرمول — فقط وقتی حداقل یکی از دو مقدار معتبر باشد
    const bpp = parsePackInt(v.boxesPerPallet);
    const spb = parsePackNum(v.sqmPerBox);
    const preview: string[] = [];
    if (spb.ok && spb.value != null) preview.push(`هر کارتن ≈ ${spb.value.toLocaleString("fa-IR", { maximumFractionDigits: 2 })} مترمربع`);
    if (bpp.ok && bpp.value != null) preview.push(`هر پالت = ${money(bpp.value)} کارتن`);
    if (bpp.ok && bpp.value != null && spb.ok && spb.value != null)
      preview.push(`هر پالت ≈ ${(bpp.value * spb.value).toLocaleString("fa-IR", { maximumFractionDigits: 2 })} مترمربع`);

    return (
      <details className="more-info">
        <summary>اطلاعاتِ بیشتر (اختیاری) — ابعاد، ضخامت، کاربری، بسته‌بندی، توضیحات</summary>
        <div className="grid2" style={{ marginTop: "var(--sp-2)" }}>
          <div><label htmlFor={`sz-${key}`}>ابعاد</label>
            <input id={`sz-${key}`} value={v.size} onChange={(e) => set({ size: e.target.value })} placeholder="۶۰×۶۰" />
            <QuickPick label="ابعاد" options={distinctVal("size")} onPick={(val) => set({ size: val })} /></div>
          <div><label htmlFor={`th-${key}`}>ضخامت</label>
            <input id={`th-${key}`} value={v.thickness} onChange={(e) => set({ thickness: e.target.value })} placeholder="۹ میلی‌متر" />
            <QuickPick label="ضخامت" options={distinctVal("thickness")} onPick={(val) => set({ thickness: val })} /></div>
          <div><label htmlFor={`ua-${key}`}>کاربری</label>
            <input id={`ua-${key}`} value={v.usageArea} onChange={(e) => set({ usageArea: e.target.value })} placeholder="کف / دیوار / نما" />
            <QuickPick label="کاربری" options={distinctVal("usageArea")} onPick={(val) => set({ usageArea: val })} /></div>
        </div>

        {/* بسته‌بندی: پایه‌ی فرمولِ تبدیلِ کارتن⇄پالت⇄مترمربع که نماینده در سفارش می‌بیند.
            مشخصه‌ی ثابتِ کارخانه است — یک‌بار اینجا تنظیم می‌شود، نه هر بار توسطِ نماینده. */}
        <div className="grid2" style={{ marginTop: "var(--sp-3)" }}>
          <div><label htmlFor={`bpp-${key}`}>تعداد کارتن در هر پالت</label>
            <input id={`bpp-${key}`} inputMode="numeric" value={v.boxesPerPallet}
              onChange={(e) => set({ boxesPerPallet: e.target.value })} placeholder="۴۸" /></div>
          <div><label htmlFor={`spb-${key}`}>متراژِ هر کارتن (مترمربع)</label>
            <input id={`spb-${key}`} inputMode="decimal" value={v.sqmPerBox}
              onChange={(e) => set({ sqmPerBox: e.target.value })} placeholder="۱٫۴۴" /></div>
        </div>
        <p className="subtle" style={{ marginTop: "var(--sp-1)" }}>
          این دو عدد فقط نسبتِ بسته‌بندی‌اند (برای فرمولِ تبدیلِ نماینده)، نه مقدارِ موجودی —
          موجودیِ واقعی را از ورودِ اکسل یا کالای در راه اضافه کنید.
        </p>
        {preview.length > 0 && (
          <p className="subtle" style={{ marginTop: "var(--sp-1)" }}>
            برای فرمولِ تبدیلِ نماینده: {preview.join("؛ ")}.
          </p>
        )}

        <label htmlFor={`de-${key}`} style={{ marginTop: "var(--sp-2)" }}>توضیحات</label>
        <textarea id={`de-${key}`} value={v.description} onChange={(e) => set({ description: e.target.value })}
                  rows={3} placeholder="توضیحاتِ محصول برای نماینده و مشتری…" />
      </details>
    );
  };

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>مدیریت محصول</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu ctx={ctx} /></nav>
      </div>

      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          محصول را همین‌جا بسازید (با عکس)، یا دسته‌جمعی از فایلِ اکسل. هر محصول می‌تواند
          <strong> گالریِ چند عکسی</strong> داشته باشد؛ عکسِ <strong>اصلی</strong> همان تامنیلی است که
          همه‌جا دیده می‌شود. جایگزین و اطلاعاتِ بیشتر (ابعاد/توضیحات) هم همین‌جا.
          {" "}<span className="num">{withImage.toLocaleString("fa-IR")}</span> از{" "}
          <span className="num">{products.length.toLocaleString("fa-IR")}</span> محصول عکس دارد.
          {" "}<strong>توجه:</strong> ساختنِ محصول اینجا فقط مشخصات و قیمت را ثبت می‌کند و
          <strong> موجودیِ انبار نمی‌سازد</strong> — تا زمانی که از{" "}
          <Link href="/staff/import">ورودِ اکسل</Link> یا <Link href="/staff/incoming">کالای در راه</Link>{" "}
          موجودی برایش ثبت نشود، برای نماینده «ناموجود» دیده می‌شود.
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
              ? <span className="thumb"><img onError={hideOnError} src={form.imageUrl} alt="پیش‌نمایش" /></span>
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
              <div><label htmlFor="pu">یا URL عکس اصلی</label>
                <input id="pu" value={form.imageUrl} onChange={(e) => setForm({ ...form, imageUrl: e.target.value })} placeholder="https://…" /></div>
            </div>
            {attrFields(form, (patch) => setForm((s) => ({ ...s, ...patch })), "new")}
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
              ? <span className="thumb"><img onError={hideOnError} src={p.imageUrl} alt={p.name} loading="lazy" /></span>
              : <span className="thumb thumb--empty" aria-hidden="true"><Icon name="info" size={20} /></span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row">
                <strong>{p.name}</strong>
                <span>
                  <span className="subtle num">{p.code}</span>
                  {!p.hasStock && (
                    <span className="badge badge--warn" style={{ marginInlineStart: ".4rem" }}>
                      بدون موجودی — <Link href="/staff/import">افزودنِ موجودی ←</Link>
                    </span>
                  )}
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

              {/* بسته‌بندی: تبدیلِ کارتن⇄پالت⇄مترمربعی که نماینده در سفارش می‌بیند، همیشه دیده می‌شود
                  تا پشتیبان بدونِ بازکردنِ ویرایش هم بتواند فرمول را ببیند. */}
              <div className="subtle" style={{ marginTop: "var(--sp-1)" }}>
                {p.boxesPerPallet || p.sqcmPerBox ? (
                  <>
                    بسته‌بندی:{" "}
                    {p.boxesPerPallet ? `${money(p.boxesPerPallet)} کارتن/پالت` : "پالت نامشخص"}
                    {p.sqcmPerBox ? ` · ${sqm(p.sqcmPerBox)} مترمربع/کارتن` : " · متراژ نامشخص"}
                  </>
                ) : "بسته‌بندی تنظیم نشده — نماینده فقط با کارتن سفارش می‌دهد"}
              </div>

              {/* گالری: اولی = اصلی (تامنیل). کلیک روی ★ = اصلی‌کردن، × = حذف. */}
              {(() => {
                const galleryBusy = pending === "img" + p.id;
                return (
                  <>
                    <div className="gallery" style={{ marginTop: "var(--sp-3)" }}>
                      {p.images.map((img, i) => (
                        <div key={img.id} className={`gallery-item ${i === 0 ? "gallery-item--primary" : ""}`}>
                          <img onError={hideOnError} src={img.url} alt="" loading="lazy" />
                          {i === 0
                            ? <span className="gallery-badge">اصلی</span>
                            : <button className="gallery-star" title="عکسِ اصلی شود" aria-label="عکسِ اصلی شود"
                                disabled={galleryBusy} onClick={() => setPrimaryImg(p.id, img.id)}>★</button>}
                          <button className="gallery-del" title="حذف عکس" aria-label="حذف عکس"
                            disabled={galleryBusy} onClick={() => removeImg(p.id, img.id)}>×</button>
                        </div>
                      ))}
                      <label className="gallery-add btn-file" title="افزودن عکس به گالری">
                        <Icon name="image" size={16} /><span style={{ fontSize: ".7rem" }}>+ عکس</span>
                        <input type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }}
                          disabled={galleryBusy}
                          onChange={async (e) => {
                            const f = e.target.files?.[0]; e.target.value = "";
                            if (!f) return;
                            setPending("img" + p.id);
                            const url = await uploadFile(f);
                            setPending(null);
                            if (url) addImg(p, url);
                          }} />
                      </label>
                      {galleryBusy && <span className="spinner" aria-hidden="true" style={{ alignSelf: "center" }} />}
                    </div>
                    {/* افزودن با URL */}
                    <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-2)" }}>
                      <input value={imgUrl[p.id] ?? ""} onChange={(e) => setImgUrl({ ...imgUrl, [p.id]: e.target.value })}
                        placeholder="یا URL عکس…" aria-label="افزودن عکس با URL" style={{ maxWidth: 240, direction: "ltr" }} />
                      <button className="ghost" disabled={!imgUrl[p.id]?.trim() || galleryBusy}
                        onClick={() => { addImg(p, imgUrl[p.id] ?? ""); setImgUrl({ ...imgUrl, [p.id]: "" }); }}>افزودن</button>
                    </div>
                  </>
                );
              })()}

              <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
                <button className="ghost" disabled={pending === "edit" + p.id}
                  onClick={() => (editFor === p.id ? setEditFor(null) : startEdit(p))}>
                  {editFor === p.id ? "بستن ویرایش" : "ویرایش"}
                </button>
                {p.variantId && (
                  <button className="ghost"
                    // یک بخشِ بازِ کارت کافی است — باز کردنِ جایگزین‌ها، ویرایشِ بازمانده را می‌بندد
                    onClick={() => {
                      setEditFor(null);
                      setSubFor(subFor === p.variantId ? null : p.variantId);
                      setSubPick(""); setSubNote(""); setSubQuery("");
                    }}>
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
                  </div>
                  {attrFields(editForm, (patch) => setEditForm((s) => ({ ...s, ...patch })), p.id)}
                  {moreFields(editForm, (patch) => setEditForm((s) => ({ ...s, ...patch })), p.id)}
                  <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
                    <button className="primary" disabled={pending === "edit" + p.id || !editForm.name.trim()}
                      onClick={() => saveEdit(p)}>
                      {pending === "edit" + p.id && <span className="spinner" aria-hidden="true" />}ذخیره
                    </button>
                    <button className="ghost" onClick={() => setEditFor(null)}>انصراف</button>
                  </div>
                </div>
              )}

              {p.variantId && subFor === p.variantId && (
                <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
                  <div className="subtle" style={{ marginBottom: "var(--sp-2)" }}>
                    اگر <strong>{p.name}</strong> نبود، این‌ها پیشنهاد می‌شوند (فقط موجودها به نماینده می‌روند):
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
