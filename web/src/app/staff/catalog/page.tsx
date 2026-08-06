"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import Icon from "../../Icon";
import { hasPageAccess } from "@/lib/staffPages";
import NavMenu from "../../NavMenu";
import { TabBar, type Tab } from "../Tabs";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { usePaginatedSearch } from "@/lib/usePaginatedSearch";
import { useContexts, type Ctx } from "@/lib/useContexts";
import { hideOnError } from "@/lib/img";
import ImportSection from "./ImportSection";
import PriceImportSection from "./PriceImportSection";
import VolumeDiscountSection from "./VolumeDiscountSection";
import EditPanel from "./EditPanel";
import PricePanel from "./PricePanel";
import IncomingPanel from "./IncomingPanel";
import SubsPanel from "./SubsPanel";
import { AttrFields, MoreFields, parsePackInt, parsePackNum, type AttrKey } from "./productFields";
import { money, sqm, type Product, type Sub, type Wh, type PriceList, type PriceItem, type IncomingItem } from "./types";
import { formatMoney } from "@/lib/money";

const EMPTY_FORM = { name: "", code: "", sku: "", color: "", glaze: "", punch: "", body: "", size: "", thickness: "", usageArea: "", description: "", imageUrl: "", boxesPerPallet: "", sqmPerBox: "", stockWarehouseId: "", stockQty: "" };

// v7: قیمت‌گذاری/موجودیِ در راه/جایگزین‌ها دیگر تب/صفحه‌ی جدا نیستند — چون
// این‌ها همیشه دربارهِ *یک* محصولِ مشخص‌اند، روی همان کارتِ محصول باز می‌شوند.
// فقط «ورود از اکسل» تبِ جداست، چون یک عملیاتِ دسته‌جمعیِ کلِ کارخانه/انبار
// است و به هیچ محصولِ واحدی تعلق ندارد — روی کارتِ یک محصول جا نمی‌شود.
const ALL_TABS: (Tab & { pageKey: string })[] = [
  { key: "catalog", label: "محصولات", pageKey: "catalog" },
  { key: "import", label: "ورود از اکسل", pageKey: "import" },
  // pageKeyِ همان «prices» است، نه یکِ تازه — بالک/تک‌قلمی/پله‌ها سه راهِ رسیدن
  // به همان دسترسی‌اند؛ گیتِ جدا یعنی مدیر باید چندبار همین اجازه را بدهد.
  { key: "priceImport", label: "ورودِ قیمت از اکسل", pageKey: "prices" },
  { key: "volumeDiscount", label: "پله‌های تخفیفِ حجمی", pageKey: "prices" },
];
type Panel = "edit" | "subs" | "price" | "incoming";

/** آیا این pageKey برای کاربر باز است؟ ادمین همیشه، وگرنه allowed_pages. */
const canSeePage = (ctx: Ctx, key: string) => ctx.role === "admin" || hasPageAccess(ctx.allowedPages, key);

/**
 * صفحه‌بندی‌شده — کارخانه‌ای با چندصد محصول دیگر کلِ کاتالوگ را در یک fetch
 * نمی‌گیرد. وقتی tenantId هنوز آماده نیست (ctxِ بیرونی در حالِ بارگذاری)، fetch
 * واقعی زده نمی‌شود؛ نتیجه‌ی خالی برمی‌گردد تا بعداً با tenantId درست دوباره بگیرد.
 */
const fetchProducts = (tenantId: string, q: string, offset: number) =>
  tenantId
    ? getJson<{ products: Product[]; hasMore: boolean }>(
        `/api/products?tenantId=${tenantId}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`)
    : Promise.resolve({ ok: true as const, data: { products: [] as Product[], hasMore: false } });

export default function CatalogPage() {
  const { ctx, state } = useContexts("staff");
  const [tab, setTab] = useState("catalog");
  const {
    rows: products, q: query, hasMore: productsHasMore, moreBusy: productsMoreBusy,
    loadErr: productsLoadErr, loaded: productsLoaded, search: searchProducts,
    loadMore: loadMoreProducts, reload: reloadProducts,
  } = usePaginatedSearch(ctx?.tenantId ?? "", fetchProducts, (raw) => raw.products);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [whs, setWhs] = useState<Wh[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [incomingItems, setIncomingItems] = useState<IncomingItem[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  // پیامِ نتیجه‌ی آخرین عملیات + نوعش (موفق/خطا) — صریح، نه با حدسِ startsWith
  // روی متنِ فارسی. آن حدس یک‌بار واقعاً اشتباه زد: «محموله ثبت شد.» با «محصول»
  // شروع نمی‌شود، پس پیامِ موفقیت قرمز و با آیکنِ خطا نشان داده می‌شد.
  const [msg, setMsgText] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  function setMsg(text: string, ok = false) { setMsgText(text); setMsgOk(ok); }
  const [loaded, setLoaded] = useState(false);

  // یک بخشِ بازِ کارت در هر لحظه (ویرایش/جایگزین‌ها/قیمت/موجودیِ در راه) — باز
  // کردنِ یکی، بازمانده‌ی همان کارت را می‌بندد تا کارت غول‌پیکر نشود.
  const [openFor, setOpenFor] = useState<{ id: string; panel: Panel } | null>(null);
  const isOpen = (id: string, panel: Panel) => openFor?.id === id && openFor.panel === panel;
  function togglePanel(id: string, panel: Panel) {
    // بدونِ این، پیامِ باقی‌مانده از عملیاتِ کارتِ قبلی زیرِ پنلِ تازه‌بازشده‌ی
    // این کارت می‌ماند — انگار همین الان همان اتفاق برای این کارت افتاده.
    if (!isOpen(id, panel)) setMsg("");
    setOpenFor(isOpen(id, panel) ? null : { id, panel });
  }
  // پنلِ ویرایش هنگامِ ذخیره busy می‌شود — تا دکمه‌ی toggle نتواند وسطِ ذخیره پنل را ببندد.
  const [editBusyId, setEditBusyId] = useState<string | null>(null);

  const [imgUrl, setImgUrl] = useState<Record<string, string>>({}); // URLِ درحال‌افزودن به گالریِ هر محصول

  const [form, setForm] = useState(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);

  // پرسیدنِ /api/substitutes|prices|incoming وقتی آن pageKey را نداری فقط ۴۰۳
  // می‌گیرد — و چون همه‌ی این ۴ درخواست یک loadErr مشترک دارند، همان ۴۰۳ به‌عنوانِ
  // «دسترسیِ این بخش را نداری» روی کلِ صفحه (که خودش کاملاً در دسترس است) می‌نشیند.
  // پس هرکدام را فقط وقتی می‌پرسیم که واقعاً بخشِ نمایش‌دهنده‌اش دیده می‌شود.
  // محصولات دیگر اینجا نیستند — صفحه‌بندیِ خودشان را در usePaginatedSearch دارند.
  const load = useCallback(async (c: Ctx) => {
    const tenantId = c.tenantId;
    const emptySubs = Promise.resolve({ ok: true as const, data: { items: [] as Sub[] } });
    const emptyPrices = Promise.resolve({ ok: true as const, data: { lists: [] as PriceList[], items: [] as PriceItem[] } });
    const emptyIncoming = Promise.resolve({ ok: true as const, data: { items: [] as IncomingItem[] } });
    const [s, w, pr, inc] = await Promise.all([
      canSeePage(c, "substitutes") ? getJson<{ items: Sub[] }>(`/api/substitutes?tenantId=${tenantId}`) : emptySubs,
      getJson<{ warehouses: Wh[] }>(`/api/warehouses?tenantId=${tenantId}`),
      canSeePage(c, "prices") ? getJson<{ lists: PriceList[]; items: PriceItem[] }>(`/api/prices?tenantId=${tenantId}`) : emptyPrices,
      canSeePage(c, "incoming") ? getJson<{ items: IncomingItem[] }>(`/api/incoming?tenantId=${tenantId}`) : emptyIncoming,
    ]);
    if (s.ok) setSubs(s.data.items);
    if (w.ok) setWhs(w.data.warehouses);
    if (pr.ok) { setPriceLists(pr.data.lists); setPriceItems(pr.data.items); }
    if (inc.ok) setIncomingItems(inc.data.items);
    const failed = [s, w, pr, inc].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, []);

  useEffect(() => { if (ctx) load(ctx); }, [ctx, load]);

  /** بعدِ هر عملیاتی که ممکن است روی محصول اثر بگذارد (قیمت/موجودی/گالری/ویرایش)
   *  هم بارِ ۴تایی و هم صفحه‌ی جاریِ محصولات را تازه می‌کند. */
  const refreshAll = useCallback(
    async (c: Ctx) => { await Promise.all([load(c), reloadProducts()]); },
    [load, reloadProducts],
  );

  // آدرسِ ورودی (مثلاً از NavMenu: ?tab=import) تبِ اولیه را تعیین می‌کند —
  // فقط در کلاینت خوانده می‌شود تا با رندرِ اول (که همیشه «catalog» است) ناسازگار نشود.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && ALL_TABS.some((x) => x.key === t)) setTab(t);
  }, []);
  function go(key: string) {
    setTab(key);
    history.replaceState(null, "", `?tab=${key}`);
  }

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
    // موجودیِ اولیه اختیاری است؛ اگر یکی از دو فیلد پر شد، هر دو لازم‌اند —
    // وگرنه «فقط انبار انتخاب شد» بی‌صدا نادیده گرفته می‌شود و کاربر فکر می‌کند ثبت شد.
    const qty = parsePackInt(form.stockQty);
    if (!qty.ok) { setMsg("تعدادِ موجودیِ اولیه نامعتبر است."); return; }
    if ((qty.value != null) !== !!form.stockWarehouseId) {
      setMsg("برای ثبتِ موجودیِ اولیه، هم انبار و هم تعداد را وارد کن."); return;
    }
    setPending("create"); setMsg("");
    const res = await postJson("/api/products", {
      tenantId: ctx.tenantId, ...form,
      boxesPerPallet: bpp.value, sqcmPerBox: spb.value != null ? Math.round(spb.value * 10000) : null,
      initialStock: qty.value != null ? { warehouseId: form.stockWarehouseId, quantityBoxes: qty.value } : undefined,
    });
    if (!res.ok) {
      const code = res.status;
      setMsg(code === 409 ? "کد یا sku تکراری است." : code === 400 ? "نام، کد و sku الزامی‌اند." : actionError(code));
    } else {
      setForm(EMPTY_FORM);
      setMsg("محصول ساخته شد.", true);
      await refreshAll(ctx);
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
    else await refreshAll(ctx);
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

  if (state === "none")
    return (
      <main>
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>این بخش فقط برای پشتیبان است.</span>
        </div>
      </main>
    );
  if (!ctx) return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;

  // v6/v7: پنج صفحه‌ی جدا (کاتالوگ/قیمت‌گذاری/ورودِ اکسل/موجودیِ در راه/جایگزین‌ها)
  // با «محصول و موجودی» ادغام شدند. قیمت‌گذاری/موجودیِ در راه/جایگزین‌ها دیگر
  // تبِ خودشان را ندارند — روی کارتِ همان محصول باز می‌شوند — ولی pageKeyِ
  // قبلی‌شان دست‌نخورده می‌ماند: هرکدام فقط وقتی دکمه‌اش را می‌بینی که آن دسترسی
  // را داری. اینطور مدیر می‌تواند پشتیبانی را فقط به «قیمت‌گذاری» محدود کند،
  // بدونِ اینکه او بتواند مشخصاتِ محصول را ویرایش کند.
  const canSee = (key: string) => canSeePage(ctx, key);
  const tabs = ctx.role === "admin" ? ALL_TABS : ALL_TABS.filter((t) => hasPageAccess(ctx.allowedPages, t.pageKey));
  if (tabs.length === 0)
    return <main><div className="banner banner--error" role="alert"><Icon name="alert" /><span>دسترسیِ این بخش برایت باز نیست — از مدیر بخواه اضافه‌اش کند.</span></div></main>;
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  const withImage = products.filter((p) => p.imageUrl).length;
  const ready = form.name.trim() && form.code.trim() && form.sku.trim();

  // مقدارهای یکتای هر فیلدِ توصیفی، برای QuickPickِ فرمِ ساخت — از همین صفحه‌ی
  // بارگذاری‌شده مشتق می‌شود (نه کلِ کاتالوگ)، چون محصولات دیگر یک‌جا نمی‌آیند.
  // ponytail: با اسکرول/جستجوی بیشتر کامل‌تر می‌شود؛ برای فهرستِ کاملِ گزینه‌ها
  // یک endpoint سبکِ «مقادیرِ یکتا» جدا لازم است، نه بارگذاریِ کلِ کاتالوگ.
  const distinctVal = (key: AttrKey) =>
    [...new Set(products.map((p) => p[key]).filter((v): v is string => !!v))].sort();

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>محصول و موجودی</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu ctx={ctx} /></nav>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={go} />

      {activeTab === "import" && <ImportSection ctx={ctx} />}
      {activeTab === "priceImport" && <PriceImportSection ctx={ctx} />}
      {activeTab === "volumeDiscount" && <VolumeDiscountSection ctx={ctx} />}
      {activeTab === "catalog" && (
      <>
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          محصول را همین‌جا بسازید (با عکس)، یا دسته‌جمعی از فایلِ اکسل. هر محصول می‌تواند
          <strong> گالریِ چند عکسی</strong> داشته باشد؛ عکسِ <strong>اصلی</strong> همان تامنیلی است که
          همه‌جا دیده می‌شود. قیمت، بسته‌بندی، موجودیِ در راه و جایگزین هم روی کارتِ
          همان محصول مدیریت می‌شوند.
          {" "}<span className="num">{withImage.toLocaleString("fa-IR")}</span> از{" "}
          <span className="num">{products.length.toLocaleString("fa-IR")}</span> محصولِ بارگذاری‌شده عکس دارد.
          {" "}می‌توانید <strong>موجودیِ اولیه</strong> را همین‌جا (پایینِ فرم) هم ثبت کنید؛ برای
          واردات دسته‌جمعی هم تبِ{" "}
          <button type="button" className="link-plain" onClick={() => go("import")} style={{ textDecoration: "underline" }}>ورودِ اکسل</button>
          {" "}هست. بدونِ هیچ‌کدام، محصول برای نماینده «ناموجود» دیده می‌شود.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      {msg && (
        <div className={`banner banner--${msgOk ? "ok" : "error"}`} role="status">
          <Icon name={msgOk ? "check" : "alert"} /><span>{msg}</span>
        </div>
      )}

      <h2>محصول جدید</h2>
      <div className="card">
        <div className="lot-head">
          <div>
            {form.imageUrl
              ? <span className="thumb"><Image onError={hideOnError} src={form.imageUrl} alt="پیش‌نمایش" loading="eager" width={88} height={88} /></span>
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
            <AttrFields v={form} set={(patch) => setForm((s) => ({ ...s, ...patch }))} keyId="new" distinctVal={distinctVal} />

            {/* موجودیِ اولیه (اختیاری) — همین‌جا هم می‌شود موجودی ثبت کرد، نه فقط
                از ورودِ اکسل. اگر خالی بماند، محصول «بدون موجودی» می‌ماند تا بعداً
                از پایینِ کارتِ همان محصول (موجودیِ در راه) پر شود. */}
            <div className="grid2" style={{ marginTop: "var(--sp-2)" }}>
              <div><label htmlFor="pw">انبار (برای موجودیِ اولیه)</label>
                <select id="pw" value={form.stockWarehouseId} onChange={(e) => setForm({ ...form, stockWarehouseId: e.target.value })}>
                  <option value="">— انتخاب نشود —</option>
                  {whs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select></div>
              <div><label htmlFor="pq">تعدادِ موجودیِ اولیه (کارتن)</label>
                <input id="pq" inputMode="numeric" value={form.stockQty}
                  onChange={(e) => setForm({ ...form, stockQty: e.target.value })} placeholder="۲۰۰" /></div>
            </div>

            <MoreFields v={form} set={(patch) => setForm((s) => ({ ...s, ...patch }))} keyId="new" distinctVal={distinctVal} />
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
      <div className="row row--start" style={{ marginBottom: "var(--sp-3)" }}>
        <input type="search" value={query} onChange={(e) => searchProducts(e.target.value)}
          placeholder="جستجوی محصول…" aria-label="جستجو" style={{ maxWidth: 280 }} />
      </div>
      {productsLoadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{productsLoadErr}</span></div>}
      {productsLoaded && products.length === 0 && <p className="empty">{query ? "چیزی پیدا نشد." : "هنوز محصولی ساخته نشده."}</p>}

      {products.map((p) => {
        const inFlight = p.variantId ? incomingItems.filter((i) => i.variantId === p.variantId
          && (i.status === "planned" || i.status === "confirmed")) : [];
        return (
        <div className="card" key={p.id}>
          <div className="lot-head">
            {p.imageUrl
              ? <span className="thumb"><Image onError={hideOnError} src={p.imageUrl} alt={p.name} loading="lazy" width={88} height={88} /></span>
              : <span className="thumb thumb--empty" aria-hidden="true"><Icon name="info" size={20} /></span>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row">
                <strong>{p.name}</strong>
                <span>
                  <span className="subtle num">{p.code}</span>
                  {!p.hasStock && (
                    <span className="badge badge--warn" style={{ marginInlineStart: "var(--sp-2)" }}>
                      بدون موجودی
                      {p.variantId && canSee("incoming") && (
                        <>
                          {" — "}
                          <button type="button" className="link-plain" onClick={() => togglePanel(p.id, "incoming")}
                            style={{ textDecoration: "underline" }}>افزودنِ موجودی ←</button>
                        </>
                      )}
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
                  ? <>قیمتِ پایه: <span className="metric">{formatMoney(p.basePrice, ctx.currencyUnit)}</span> / کارتن</>
                  : <span className="subtle">قیمتی ثبت نشده</span>}
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
                          <Image onError={hideOnError} src={img.url} alt="" loading="lazy" width={72} height={72} />
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
                <button className="ghost" disabled={editBusyId === p.id}
                  onClick={() => togglePanel(p.id, "edit")}>
                  {isOpen(p.id, "edit") ? "بستن ویرایش" : "ویرایش"}
                </button>
                {p.variantId && canSee("prices") && (
                  <button className="ghost" onClick={() => togglePanel(p.id, "price")}>
                    {isOpen(p.id, "price") ? "بستنِ قیمت" : "قیمت‌گذاری"}
                  </button>
                )}
                {p.variantId && canSee("incoming") && (
                  <button className="ghost" onClick={() => togglePanel(p.id, "incoming")}>
                    {isOpen(p.id, "incoming") ? "بستنِ موجودیِ در راه" : `موجودی در راه${inFlight.length ? ` (${money(inFlight.length)})` : ""}`}
                  </button>
                )}
                {p.variantId && canSee("substitutes") && (
                  <button className="ghost" onClick={() => togglePanel(p.id, "subs")}>
                    {isOpen(p.id, "subs") ? "بستنِ جایگزین‌ها" : `جایگزین‌ها (${money(subs.filter((s) => s.variantId === p.variantId).length)})`}
                  </button>
                )}
                {editBusyId === p.id && <span className="spinner" aria-hidden="true" />}
              </div>

              {/* پیامِ نتیجه‌ی عملیات اینجا هم تکرار می‌شود، نه فقط بالای صفحه — چون
                  این کارت ممکن است خیلی پایین‌تر از بنرِ سراسری باشد و کاربر هرگز آن
                  را نبیند (مثلاً بعد از «تأیید رسیدن» در فهرستی بلند از محصولات). */}
              {msg && openFor?.id === p.id && (
                <div className={`banner banner--${msgOk ? "ok" : "error"}`}
                  role="status" style={{ marginTop: "var(--sp-3)" }}>
                  <Icon name={msgOk ? "check" : "alert"} /><span>{msg}</span>
                </div>
              )}

              {isOpen(p.id, "edit") && (
                <EditPanel ctx={ctx} product={p} products={products}
                  onSaved={() => refreshAll(ctx)} onClose={() => setOpenFor(null)}
                  onMsg={setMsg} onBusyChange={(busy) => setEditBusyId(busy ? p.id : null)} />
              )}

              {p.variantId && isOpen(p.id, "price") && (
                <PricePanel ctx={ctx} product={p} priceLists={priceLists} priceItems={priceItems}
                  onSaved={() => refreshAll(ctx)} onMsg={setMsg} onGoImport={() => go("priceImport")} />
              )}

              {p.variantId && isOpen(p.id, "incoming") && (
                <IncomingPanel ctx={ctx} product={p} whs={whs} incomingItems={incomingItems}
                  onSaved={() => refreshAll(ctx)} onMsg={setMsg} />
              )}

              {p.variantId && isOpen(p.id, "subs") && (
                <SubsPanel ctx={ctx} product={p} products={products} subs={subs}
                  onSaved={() => refreshAll(ctx)} onMsg={setMsg} />
              )}
            </div>
          </div>
        </div>
        );
      })}
      {productsHasMore && (
        <button onClick={loadMoreProducts} aria-busy={productsMoreBusy} disabled={productsMoreBusy} style={{ width: "100%" }}>
          {productsMoreBusy && <span className="spinner" aria-hidden="true" />}بیشتر
        </button>
      )}
      </>
      )}
    </main>
  );
}
