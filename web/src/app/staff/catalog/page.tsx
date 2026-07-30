"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import { hasPageAccess } from "@/lib/staffPages";
import NavMenu from "../../NavMenu";
import { TabBar, type Tab } from "../Tabs";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { useContexts, type Ctx } from "@/lib/useContexts";
import { matches, normalize } from "@/lib/search";
import { hideOnError } from "@/lib/img";
import { JalaliDateInput } from "@/lib/JalaliDateInput";
import { formatJalaliDate, jalaliToDate, todayJalali, type Jalali } from "@/lib/date";
import ImportSection from "./ImportSection";
import PriceImportSection from "./PriceImportSection";

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
type Wh = { id: string; name: string; code: string };
type PriceList = { id: string; name: string; agentCount: number };
type PriceItem = { priceListId: string; variantId: string; price: string };
type IncomingItem = {
  id: string; variantId: string;
  warehouseId: string; warehouseName: string;
  quantityBoxes: number; expectedAt: string;
  source: string; status: "planned" | "confirmed" | "arrived" | "cancelled"; note: string | null;
};

const money = (v: number) => v.toLocaleString("fa-IR");
const sqm = (cm2: number) => (cm2 / 10000).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
const EMPTY_FORM = { name: "", code: "", sku: "", color: "", glaze: "", punch: "", body: "", size: "", thickness: "", usageArea: "", description: "", imageUrl: "", boxesPerPallet: "", sqmPerBox: "", stockWarehouseId: "", stockQty: "" };
const EMPTY_EDIT = { name: "", color: "", glaze: "", punch: "", body: "", size: "", thickness: "", usageArea: "", description: "", boxesPerPallet: "", sqmPerBox: "" };
const INCOMING_STATUS_FA: Record<string, string> = {
  planned: "برنامه‌ریزی‌شده", confirmed: "قطعی‌شده", arrived: "رسیده", cancelled: "لغوشده",
};
const INCOMING_SOURCE_FA: Record<string, string> = {
  production: "تولید", transfer: "انتقال بین انبار", purchase: "خرید",
};

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

// v7: قیمت‌گذاری/موجودیِ در راه/جایگزین‌ها دیگر تب/صفحه‌ی جدا نیستند — چون
// این‌ها همیشه دربارهِ *یک* محصولِ مشخص‌اند، روی همان کارتِ محصول باز می‌شوند.
// فقط «ورود از اکسل» تبِ جداست، چون یک عملیاتِ دسته‌جمعیِ کلِ کارخانه/انبار
// است و به هیچ محصولِ واحدی تعلق ندارد — روی کارتِ یک محصول جا نمی‌شود.
const ALL_TABS: (Tab & { pageKey: string })[] = [
  { key: "catalog", label: "محصولات", pageKey: "catalog" },
  { key: "import", label: "ورود از اکسل", pageKey: "import" },
  // pageKeyِ همان «prices» است، نه یکِ تازه — بالک/تک‌قلمی دو راهِ رسیدن به
  // همان دسترسی‌اند؛ گیتِ جدا یعنی مدیر باید دوبار همین اجازه را بدهد.
  { key: "priceImport", label: "ورودِ قیمت از اکسل", pageKey: "prices" },
];
type Panel = "edit" | "subs" | "price" | "incoming";

/** آیا این pageKey برای کاربر باز است؟ ادمین همیشه، وگرنه allowed_pages. */
const canSeePage = (ctx: Ctx, key: string) => ctx.role === "admin" || hasPageAccess(ctx.allowedPages, key);

export default function CatalogPage() {
  const { ctx, state } = useContexts("staff");
  const [tab, setTab] = useState("catalog");
  const [products, setProducts] = useState<Product[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [whs, setWhs] = useState<Wh[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [incomingItems, setIncomingItems] = useState<IncomingItem[]>([]);
  const [query, setQuery] = useState("");
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

  const [subPick, setSubPick] = useState("");
  const [subNote, setSubNote] = useState("");
  const [subQuery, setSubQuery] = useState("");
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [imgUrl, setImgUrl] = useState<Record<string, string>>({}); // URLِ درحال‌افزودن به گالریِ هر محصول

  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [priceSaving, setPriceSaving] = useState<string | null>(null);

  const [incWarehouseId, setIncWarehouseId] = useState("");
  const [incQty, setIncQty] = useState("");
  const [incWhen, setIncWhen] = useState<Jalali>(todayJalali);
  const [incSource, setIncSource] = useState("production");
  const [incNote, setIncNote] = useState("");
  const [incArriving, setIncArriving] = useState<string | null>(null);
  const [incBatch, setIncBatch] = useState("");

  const [form, setForm] = useState(EMPTY_FORM);
  const [uploading, setUploading] = useState(false);

  // پرسیدنِ /api/substitutes|prices|incoming وقتی آن pageKey را نداری فقط ۴۰۳
  // می‌گیرد — و چون همه‌ی این ۵ درخواست یک loadErr مشترک دارند، همان ۴۰۳ به‌عنوانِ
  // «دسترسیِ این بخش را نداری» روی کلِ صفحه (که خودش کاملاً در دسترس است) می‌نشیند.
  // پس هرکدام را فقط وقتی می‌پرسیم که واقعاً بخشِ نمایش‌دهنده‌اش دیده می‌شود.
  const load = useCallback(async (c: Ctx) => {
    const tenantId = c.tenantId;
    const emptySubs = Promise.resolve({ ok: true as const, data: { items: [] as Sub[] } });
    const emptyPrices = Promise.resolve({ ok: true as const, data: { lists: [] as PriceList[], items: [] as PriceItem[] } });
    const emptyIncoming = Promise.resolve({ ok: true as const, data: { items: [] as IncomingItem[] } });
    const [p, s, w, pr, inc] = await Promise.all([
      getJson<{ products: Product[] }>(`/api/products?tenantId=${tenantId}`),
      canSeePage(c, "substitutes") ? getJson<{ items: Sub[] }>(`/api/substitutes?tenantId=${tenantId}`) : emptySubs,
      getJson<{ warehouses: Wh[] }>(`/api/warehouses?tenantId=${tenantId}`),
      canSeePage(c, "prices") ? getJson<{ lists: PriceList[]; items: PriceItem[] }>(`/api/prices?tenantId=${tenantId}`) : emptyPrices,
      canSeePage(c, "incoming") ? getJson<{ items: IncomingItem[] }>(`/api/incoming?tenantId=${tenantId}`) : emptyIncoming,
    ]);
    if (p.ok) setProducts(p.data.products);
    if (s.ok) setSubs(s.data.items);
    if (w.ok) setWhs(w.data.warehouses);
    if (pr.ok) { setPriceLists(pr.data.lists); setPriceItems(pr.data.items); }
    if (inc.ok) setIncomingItems(inc.data.items);
    const failed = [p, s, w, pr, inc].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, []);

  useEffect(() => { if (ctx) load(ctx); }, [ctx, load]);

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
      await load(ctx);
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
    else await load(ctx);
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
    setEditForm({
      name: p.name, color: p.color ?? "", glaze: p.glaze ?? "", punch: p.punch ?? "", body: p.body ?? "",
      size: p.size ?? "", thickness: p.thickness ?? "", usageArea: p.usageArea ?? "", description: p.description ?? "",
      boxesPerPallet: p.boxesPerPallet != null ? String(p.boxesPerPallet) : "",
      sqmPerBox: p.sqcmPerBox != null ? String(p.sqcmPerBox / 10000) : "",
    });
    setOpenFor({ id: p.id, panel: "edit" }); setMsg("");
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
    else { setOpenFor(null); setMsg("محصول ویرایش شد.", true); await load(ctx); }
    setPending(null);
  }

  async function addSub(variantId: string) {
    if (!ctx || !subPick) return;
    setPending("sub" + variantId); setMsg("");
    const res = await postJson("/api/substitutes",
      { tenantId: ctx.tenantId, variantId, substituteVariantId: subPick, note: subNote });
    if (!res.ok) setMsg(actionError(res.status));
    else { setSubPick(""); setSubNote(""); await load(ctx); }
    setPending(null);
  }

  async function removeSub(id: string) {
    if (!ctx) return;
    setPending("subdel" + id); setMsg("");
    const res = await postJson("/api/substitutes", { tenantId: ctx.tenantId, id }, "DELETE");
    if (!res.ok) setMsg(actionError(res.status));
    else await load(ctx);
    setPending(null);
  }

  async function savePrice(priceListId: string, variantId: string) {
    if (!ctx) return;
    const key = priceListId + variantId;
    const raw = priceDraft[key];
    const price = Number(raw);
    if (!Number.isInteger(price) || price < 0) { setMsg("قیمت باید عددِ صحیحِ نامنفی باشد (ریال)."); return; }
    setPriceSaving(key); setMsg("");
    const res = await postJson("/api/prices", { tenantId: ctx.tenantId, priceListId, variantId, price });
    if (!res.ok) setMsg(actionError(res.status));
    else {
      setPriceDraft((s) => { const n = { ...s }; delete n[key]; return n; });
      await load(ctx);
    }
    setPriceSaving(null);
  }

  async function addIncoming(variantId: string) {
    if (!ctx || !incWarehouseId || Number(incQty) <= 0) return;
    setPending("incadd"); setMsg("");
    const res = await postJson("/api/incoming", {
      tenantId: ctx.tenantId, variantId, warehouseId: incWarehouseId,
      quantityBoxes: Number(incQty),
      expectedAt: jalaliToDate(incWhen).toISOString().slice(0, 10),
      source: incSource, note: incNote,
    });
    if (!res.ok) setMsg(actionError(res.status));
    else {
      setIncQty(""); setIncNote(""); setMsg("محموله ثبت شد.", true);
      await load(ctx);
    }
    setPending(null);
  }

  async function actIncoming(id: string, action: "arrive" | "confirm" | "cancel", batchNumber?: string) {
    if (!ctx) return;
    setPending(id + action); setMsg("");
    const res = await postJson("/api/incoming", { tenantId: ctx.tenantId, id, action, batchNumber }, "PATCH");
    if (!res.ok) setMsg(actionError(res.status));
    else {
      if (action === "arrive") {
        const d = res.data as { offers?: number; notified?: number };
        setMsg(`موجودی وارد شد.${d.offers ? ` ${money(d.offers)} نوبت از صف انتظار پر شد.` : ""}`
          + `${d.notified ? ` ${money(d.notified)} اعلان «موجود شد» صف شد.` : ""}`, true);
        setIncArriving(null); setIncBatch("");
      } else setMsg("انجام شد.", true);
      await load(ctx);
    }
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
          موجودیِ واقعی را از پایینِ همین کارت یا تبِ «ورود از اکسل» اضافه کنید.
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
          <h1>محصول و موجودی</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu ctx={ctx} /></nav>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={go} />

      {activeTab === "import" && <ImportSection ctx={ctx} />}
      {activeTab === "priceImport" && <PriceImportSection ctx={ctx} />}
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
          <span className="num">{products.length.toLocaleString("fa-IR")}</span> محصول عکس دارد.
          {" "}می‌توانید <strong>موجودیِ اولیه</strong> را همین‌جا (پایینِ فرم) هم ثبت کنید؛ برای
          واردات دسته‌جمعی هم تبِ{" "}
          <button type="button" onClick={() => go("import")} style={{ all: "unset", cursor: "pointer", textDecoration: "underline" }}>ورودِ اکسل</button>
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

      {visible.map((p) => {
        const inFlight = p.variantId ? incomingItems.filter((i) => i.variantId === p.variantId
          && (i.status === "planned" || i.status === "confirmed")) : [];
        return (
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
                      بدون موجودی
                      {p.variantId && canSee("incoming") && (
                        <>
                          {" — "}
                          <button type="button" onClick={() => togglePanel(p.id, "incoming")}
                            style={{ all: "unset", cursor: "pointer", textDecoration: "underline" }}>افزودنِ موجودی ←</button>
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
                  ? <>قیمتِ پایه: <span className="metric">{money(p.basePrice)}</span> ریال / کارتن</>
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
                  onClick={() => (isOpen(p.id, "edit") ? setOpenFor(null) : startEdit(p))}>
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
                  <button className="ghost" onClick={() => {
                    setSubPick(""); setSubNote(""); setSubQuery("");
                    togglePanel(p.id, "subs");
                  }}>
                    {isOpen(p.id, "subs") ? "بستنِ جایگزین‌ها" : `جایگزین‌ها (${money(subs.filter((s) => s.variantId === p.variantId).length)})`}
                  </button>
                )}
                {pending === "edit" + p.id && <span className="spinner" aria-hidden="true" />}
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
                    <button className="ghost" onClick={() => setOpenFor(null)}>انصراف</button>
                  </div>
                </div>
              )}

              {p.variantId && isOpen(p.id, "price") && (
                <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
                  {priceLists.length === 0
                    ? <p className="subtle">هنوز لیست قیمتی ساخته نشده.</p>
                    : priceLists.map((pl) => {
                        const existing = priceItems.find((i) => i.priceListId === pl.id && i.variantId === p.variantId);
                        const key = pl.id + p.variantId;
                        const val = priceDraft[key] ?? (existing ? existing.price : "");
                        const dirty = priceDraft[key] !== undefined && priceDraft[key] !== (existing ? existing.price : "");
                        return (
                          <div key={pl.id} className="row row--start row--stack-mobile" style={{ marginBottom: "var(--sp-2)" }}>
                            <span className="subtle">{pl.name}</span>
                            <label htmlFor={`price-${key}`} className="sr-only">قیمت {p.name} در {pl.name}</label>
                            <input id={`price-${key}`} type="number" min={0} step={1} inputMode="numeric" placeholder="قیمت (ریال)"
                              value={val} style={{ maxWidth: 200 }}
                              onChange={(e) => setPriceDraft((s) => ({ ...s, [key]: e.target.value }))} />
                            <button onClick={() => savePrice(pl.id, p.variantId!)} aria-busy={priceSaving === key}
                              className={dirty ? "primary" : undefined}
                              disabled={priceSaving === key || val === "" || !dirty}>
                              {priceSaving === key && <span className="spinner" aria-hidden="true" />}
                              {dirty ? "ذخیره" : "ذخیره شده"}
                            </button>
                          </div>
                        );
                      })}
                </div>
              )}

              {p.variantId && isOpen(p.id, "incoming") && (
                <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
                  <div className="subtle" style={{ marginBottom: "var(--sp-2)" }}>
                    محموله‌ی در راه قابلِ سفارش نیست و در موجودی شمرده نمی‌شود — فقط تاریخِ تقریبیِ رسیدن را
                    به نماینده نشان می‌دهد. با زدنِ «رسید»، موجودیِ واقعی وارد می‌شود.
                  </div>
                  <div className="grid2">
                    <div><label htmlFor={`iw-${p.id}`}>انبار مقصد</label>
                      <select id={`iw-${p.id}`} value={incWarehouseId} onChange={(e) => setIncWarehouseId(e.target.value)}>
                        <option value="">انتخاب انبار…</option>
                        {whs.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
                      </select></div>
                    <div><label htmlFor={`iq-${p.id}`}>تعداد کارتن</label>
                      <input id={`iq-${p.id}`} type="number" min={1} inputMode="numeric" value={incQty}
                        onChange={(e) => setIncQty(e.target.value)} /></div>
                  </div>
                  <label style={{ marginBottom: 0 }}>تاریخ تقریبی رسیدن</label>
                  <JalaliDateInput label="" value={incWhen} onChange={setIncWhen} currentYear={todayJalali().jy + 1} />
                  <div className="grid2">
                    <div><label htmlFor={`is-${p.id}`}>منبع</label>
                      <select id={`is-${p.id}`} value={incSource} onChange={(e) => setIncSource(e.target.value)}>
                        <option value="production">تولید</option>
                        <option value="transfer">انتقال بین انبار</option>
                        <option value="purchase">خرید</option>
                      </select></div>
                    <div><label htmlFor={`in-${p.id}`}>توضیح (اختیاری)</label>
                      <input id={`in-${p.id}`} value={incNote} onChange={(e) => setIncNote(e.target.value)} placeholder="مثلاً: بچ تولید مهر" /></div>
                  </div>
                  <button className="primary" onClick={() => addIncoming(p.variantId!)} aria-busy={pending === "incadd"}
                    disabled={pending === "incadd" || !incWarehouseId || Number(incQty) <= 0}
                    style={{ width: "100%", marginTop: "var(--sp-2)" }}>
                    {pending === "incadd" && <span className="spinner" aria-hidden="true" />}ثبت محموله
                  </button>

                  {incomingItems.filter((i) => i.variantId === p.variantId).map((i) => (
                    <div className="card" key={i.id} style={{ marginTop: "var(--sp-3)" }}>
                      <div className="row">
                        <span className={`badge ${i.status === "confirmed" ? "badge--ok" : "badge--warn"}`}>
                          {INCOMING_STATUS_FA[i.status]}
                        </span>
                      </div>
                      <div className="muted">
                        <span className="metric">{money(i.quantityBoxes)}</span> کارتن → {i.warehouseName}
                        {" · "}حدودِ {formatJalaliDate(i.expectedAt)}
                        {" · "}{INCOMING_SOURCE_FA[i.source] ?? i.source}
                      </div>
                      {i.note && <div className="subtle">{i.note}</div>}

                      {i.status === "arrived" || i.status === "cancelled" ? null : incArriving === i.id ? (
                        <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
                          <label htmlFor={`batch-${i.id}`} className="sr-only">شماره بچ برای {p.name}</label>
                          <input id={`batch-${i.id}`} value={incBatch} onChange={(e) => setIncBatch(e.target.value)}
                                 placeholder="شماره بچ (اختیاری)" style={{ maxWidth: 200 }} autoFocus />
                          <button className="primary" onClick={() => actIncoming(i.id, "arrive", incBatch.trim() || undefined)}
                                  aria-busy={pending === i.id + "arrive"} disabled={pending === i.id + "arrive"}>
                            {pending === i.id + "arrive" && <span className="spinner" aria-hidden="true" />}تأیید رسیدن
                          </button>
                          <button className="ghost" onClick={() => { setIncArriving(null); setIncBatch(""); }}>انصراف</button>
                        </div>
                      ) : (
                        <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
                          <button className="primary" onClick={() => { setIncArriving(i.id); setIncBatch(""); }}>رسید</button>
                          {i.status === "planned" && (
                            <button className="ghost" onClick={() => actIncoming(i.id, "confirm")}
                                    aria-busy={pending === i.id + "confirm"} disabled={pending === i.id + "confirm"}>
                              قطعی شد
                            </button>
                          )}
                          <button className="danger" onClick={() => actIncoming(i.id, "cancel")}
                                  aria-busy={pending === i.id + "cancel"} disabled={pending === i.id + "cancel"}>
                            لغو
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {p.variantId && isOpen(p.id, "subs") && (
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
        );
      })}
      </>
      )}
    </main>
  );
}
