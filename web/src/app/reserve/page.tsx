"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { useContexts, type Ctx } from "@/lib/useContexts";
import { formatMoney, formatMoneyWords } from "@/lib/money";
import ContextSwitcher from "../ContextSwitcher";
import LogoutButton from "../LogoutButton";
import Icon from "../Icon";
import MessageBanner from "../MessageBanner";
import { matches } from "@/lib/search";
import { hideOnError } from "@/lib/img";
import { ImageGalleryModal } from "../ImageGalleryModal";
import QtyPicker from "./QtyPicker";
import CartSummary from "./CartSummary";
import OutOfStockSection, { type WaitlistEntry, type Arrival, type Substitute } from "./OutOfStockSection";

type Lot = {
  lot_id: string; name: string; code: string; grade: string | null;
  shade_code: string | null; caliber_code: string | null;
  available: number; boxes_per_pallet: number | null; sqcm_per_box: number | null;
  unitPrice: number | null;
  warehouse_id: string; warehouse_name: string;
  image_url: string | null; color: string | null; glaze: string | null;
  punch: string | null; body: string | null;
  size: string | null; thickness: string | null; usage_area: string | null; description: string | null;
  images: { id: string; url: string }[];
};

// پول در دیتابیس عددِ صحیح است؛ اعشار/جداکننده فقط همین‌جا در لایه‌ی UI (قانون #۷)
const money = (v: number) => v.toLocaleString("fa-IR");

export default function ReservePage() {
  const { contexts, ctx, state, select } = useContexts("agent");
  const [lots, setLots] = useState<Lot[]>([]);
  // ponytail: سبد state محلیه، نه Zustand — یک صفحه‌ست. وقتی سبد چند-route شد، Zustand (spec ۱۱.۴).
  const [cart, setCart] = useState<Record<string, number>>({});
  // کلیدِ idempotency باید بینِ تلاش‌های دوباره‌ی همین سبد ثابت بماند — وگرنه
  // «ارتباط برقرار نشد» و کلیکِ دوباره یعنی سرور (اگر واقعاً پردازش کرده بود)
  // آن را سفارشِ جداگانه می‌بیند: رزروِ دوبرابر روی همان موجودی. فقط بعد از
  // موفقیت (خالی‌شدنِ سبد) پاک می‌شود تا سفارشِ بعدی کلیدِ تازه بگیرد.
  const idempotencyKeyRef = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [subscribed, setSubscribed] = useState<string[]>([]);
  const [outOfStock, setOutOfStock] = useState<{ variantId: string; name: string; code: string }[]>([]);
  const [alertPending, setAlertPending] = useState<string | null>(null);
  const [queue, setQueue] = useState<WaitlistEntry[]>([]);
  const [queueQty, setQueueQty] = useState<Record<string, string>>({});
  const [queuePending, setQueuePending] = useState<string | null>(null);
  const [whFilter, setWhFilter] = useState(""); // "" = همه‌ی انبارها
  const [query, setQuery] = useState("");
  // فیلترِ ساخت‌یافته بر ویژگی‌ها؛ "" = بی‌قید. مقدارها از خودِ اقلامِ موجود ساخته می‌شوند.
  const [attr, setAttr] = useState<{ color: string; glaze: string; punch: string; body: string }>(
    { color: "", glaze: "", punch: "", body: "" });
  // جستجو در گزینه‌های هر فیلتر — فقط وقتی گزینه‌ها زیاد شوند نشان داده می‌شود (پایین‌تر)
  const [attrSearch, setAttrSearch] = useState<{ color: string; glaze: string; punch: string; body: string }>(
    { color: "", glaze: "", punch: "", body: "" });
  // فیلترهای رنگ/لعاب/پانچ/بدنه پشتِ یک toggle جمع می‌شوند — قبلش روی موبایل
  // ~۴۰٪ صفحه قبل از دیدنِ اولین کالا با چروم پر می‌شد (Phase 3 audit).
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  // مودالِ جزئیات + گالری — فقط شناسه نگه‌داشته می‌شود، نه خودِ آبجکت؛ وگرنه اگر
  // lots در پس‌زمینه رفرش شود (مثلاً بعدِ یک عملیاتِ دیگر)، مودال داده‌ی کهنه نشان می‌دهد.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const openPreview = (l: Lot) => { setPreviewId(l.lot_id); setGalleryIdx(0); };
  const preview = lots.find((l) => l.lot_id === previewId) ?? null;
  const [subs, setSubs] = useState<Record<string, Substitute[]>>({});
  const [arrivals, setArrivals] = useState<Record<string, Arrival[]>>({});
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const loadLots = useCallback(async (c: Ctx) => {
    const [lotsRes, alertsRes, queueRes] = await Promise.all([
      getJson<{ lots: Lot[] }>(`/api/lots?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`),
      getJson<{
        subscribed: string[]; outOfStock: { variantId: string; name: string; code: string }[];
        substitutes: Record<string, Substitute[]>;
        arrivals: Record<string, Arrival[]>;
      }>(`/api/alerts?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`),
      getJson<{ entries: WaitlistEntry[] }>(
        `/api/waitlist?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`),
    ]);
    if (lotsRes.ok) {
      setLots(lotsRes.data.lots);
      // اگر لاتی که در سبد بود از فهرست افتاد (مثلاً موجودی‌اش صفر شد چون نمایندهٔ
      // دیگری زودتر رزرو کرد)، سبد باید هم‌گام بماند — وگرنه یک ردیفِ نامرئی در
      // جمعِ سبد می‌ماند که کاربر نه می‌بیند نه می‌تواند حذفش کند، و همان مقدار در
      // «ثبت رزرو» فرستاده می‌شود و کلِ سبد (همه‌یا‌هیچ) را بی‌دلیل رد می‌کند.
      let staleDropped = false;
      setCart((prev) => {
        const next: Record<string, number> = {};
        for (const [lotId, qty] of Object.entries(prev)) {
          const lot = lotsRes.data.lots.find((l) => l.lot_id === lotId);
          if (!lot) { staleDropped = true; continue; }
          const clamped = Math.min(qty, lot.available);
          if (clamped !== qty) staleDropped = true;
          if (clamped > 0) next[lotId] = clamped;
        }
        return staleDropped ? next : prev;
      });
      if (staleDropped)
        setMsg({ kind: "err", text: "موجودیِ بعضی اقلامِ سبد تغییر کرد — سبد به‌روزرسانی شد، دوباره بررسی کن." });
    }
    if (alertsRes.ok) {
      setSubscribed(alertsRes.data.subscribed);
      setOutOfStock(alertsRes.data.outOfStock);
      setSubs(alertsRes.data.substitutes ?? {});
      setArrivals(alertsRes.data.arrivals ?? {});
    }
    if (queueRes.ok) setQueue(queueRes.data.entries);
    // «کالایی نیست» نباید وقتی نگرفتیم نشان داده شود
    const failed = [lotsRes, alertsRes, queueRes].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, []);

  async function toggleAlert(variantId: string, on: boolean) {
    if (!ctx) return;
    setAlertPending(variantId); setMsg(null);
    // اگر ۴۰۳/۵۰۰ بخورد و بی‌سروصدا رد شود، دکمه هیچ‌کاری نکرده به‌نظر می‌رسد —
    // نتیجه باید چک شود، نه اینکه فقط reload بی‌قیدوشرط بزنیم (همان تله‌ای که
    // در پنل پشتیبان قبلاً پیدا شد).
    const res = await postJson("/api/alerts",
      { tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId, variantId }, on ? "POST" : "DELETE");
    if (!res.ok) setMsg({ kind: "err", text: actionError(res.status) });
    else await loadLots(ctx);
    setAlertPending(null);
  }

  async function joinQueue(variantId: string) {
    if (!ctx) return;
    const quantityBoxes = Number(queueQty[variantId]);
    if (!Number.isInteger(quantityBoxes) || quantityBoxes <= 0) return;
    setQueuePending(variantId); setMsg(null);
    const res = await postJson("/api/waitlist",
      { tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId, variantId, quantityBoxes });
    if (res.ok) {
      setMsg({ kind: "ok", text: "در صف قرار گرفتی. به‌محض آزاد شدن موجودی، همان تعداد برایت رزرو می‌شود." });
      await loadLots(ctx);
    } else setMsg({ kind: "err", text: actionError(res.status) });
    setQueuePending(null);
  }

  async function leaveQueue(variantId: string) {
    if (!ctx) return;
    setQueuePending(variantId); setMsg(null);
    const res = await postJson("/api/waitlist",
      { tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId, variantId }, "DELETE");
    if (!res.ok) setMsg({ kind: "err", text: actionError(res.status) });
    else await loadLots(ctx);
    setQueuePending(null);
  }

  // با تغییر نمایندگی، داده‌ی همان نمایندگی دوباره بارگذاری می‌شود
  useEffect(() => { if (ctx) { setCart({}); loadLots(ctx); } }, [ctx, loadLots]);

  // این‌ها همه از cart/lots مشتق می‌شوند و بدونِ useMemo در هر رندر از نو
  // محاسبه می‌شدند — یعنی هر keystrokeِ QtyPicker (که به‌ازای هر رقم parent را
  // رندر می‌کند) کل فهرستِ lots را چند بار filter/map/find می‌زد. با کاتالوگِ
  // بزرگ محسوس می‌شود؛ با useMemo فقط وقتی cart یا lots واقعاً عوض شود دوباره می‌رود.
  const items = useMemo(() => Object.entries(cart).filter(([, q]) => q > 0), [cart]);

  const shades = useMemo(() =>
    new Set(items.map(([id]) => lots.find((l) => l.lot_id === id)?.shade_code).filter(Boolean)),
    [items, lots]);
  const mixedShade = shades.size > 1; // spec ۷.۲: هشدار نرم، نه منع

  // فهرستِ انبارها از خودِ اقلام ساخته می‌شود، نه یک کوئریِ جدا: انباری که چیزی
  // برای سفارش ندارد، فیلترِ بی‌نتیجه می‌سازد.
  const warehouses = useMemo(() =>
    [...new Map(lots.map((l) => [l.warehouse_id, l.warehouse_name])).entries()],
    [lots]);

  // مقدارهای یکتای هر ویژگی، فقط از اقلامِ موجود — تا فیلترِ بی‌نتیجه ساخته نشود.
  // دراپ‌داون فقط وقتی نشان داده می‌شود که ۲ مقدار یا بیشتر باشد (یک مقدار فیلترِ بی‌فایده است).
  const attrOpts = useMemo(() => {
    const distinct = (key: "color" | "glaze" | "punch" | "body") =>
      [...new Set(lots.map((l) => l[key]).filter((v): v is string => !!v))].sort();
    return { color: distinct("color"), glaze: distinct("glaze"), punch: distinct("punch"), body: distinct("body") };
  }, [lots]);
  const attrActive = attr.color || attr.glaze || attr.punch || attr.body;

  // جستجو روی نام/کد/شید/کالیبر (spec ۱۱.۲). نرمال‌سازیِ ارقام و حروف در lib/search.
  const visibleLots = useMemo(() => lots.filter((l) =>
    (!whFilter || l.warehouse_id === whFilter)
    && (!attr.color || l.color === attr.color)
    && (!attr.glaze || l.glaze === attr.glaze)
    && (!attr.punch || l.punch === attr.punch)
    && (!attr.body || l.body === attr.body)
    && matches(query, [l.name, l.code, l.grade, l.shade_code, l.caliber_code])),
    [lots, whFilter, attr, query]);

  // سفارشِ دوانباره ممنوع نیست — فقط دو حواله می‌شود. هشدارِ نرم، مثل شیدِ مخلوط،
  // چون یک کامیون نمی‌تواند از دو انبار بار بزند و نماینده باید از قبل بداند.
  const cartWarehouses = useMemo(() =>
    new Set(items.map(([id]) => lots.find((l) => l.lot_id === id)?.warehouse_name).filter(Boolean)),
    [items, lots]);
  const mixedWarehouse = cartWarehouses.size > 1;

  // جمعِ زنده‌ی سبد. برای کسی که تلفنی با مشتری هماهنگ می‌کند «الان چقدر شد؟»
  // سؤالِ لحظه‌به‌لحظه است. این فقط برآوردِ نمایشی است — قیمتِ قطعی در لحظه‌ی
  // **تأیید** snapshot می‌شود (تخفیفِ حجمی هم آنجا)، نه اینجا؛ پس صریح «تقریبی»
  // گفته می‌شود تا با فاکتور اشتباه نشود.
  const { cartBoxes, cartValue, anyUnpriced } = useMemo(() => {
    let cartBoxes = 0, cartValue = 0, anyUnpriced = false;
    for (const [id, q] of items) {
      cartBoxes += q;
      const lot = lots.find((l) => l.lot_id === id);
      if (lot?.unitPrice != null) cartValue += lot.unitPrice * q;
      else anyUnpriced = true;
    }
    return { cartBoxes, cartValue, anyUnpriced };
  }, [items, lots]);

  async function submit() {
    if (!ctx || items.length === 0) return;
    setMsg(null);
    setPending(true); // pending state، بدون optimistic و بدون refetch-before-submit (spec ۱۱.۱/۱۱.۲)
    // فقط اگر تلاشِ قبلی کلیدی برای همین سبد نساخته: کلیک‌های دوباره‌ی بعد از
    // «ارتباط برقرار نشد» باید همان کلید را دوباره بفرستند، وگرنه اگر سرور واقعاً
    // پردازش کرده باشد ولی پاسخ نرسیده، تلاشِ دوم سفارشِ جداگانه ثبت می‌کند.
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: ctx.tenantId,
          agentAccountId: ctx.agentAccountId,
          idempotencyKey: idempotencyKeyRef.current,
          items: items.map(([lotId, quantityBoxes]) => ({ lotId, quantityBoxes })),
        }),
      });
      // پاسخِ قطعی رسید (موفق یا رد) — این کلید دیگر لازم نیست، تلاشِ بعدی (اگر
      // بود) تصمیمِ تازه‌ای است (مثلاً تعدادِ عوض‌شده) و باید کلیدِ تازه بگیرد.
      idempotencyKeyRef.current = null;
      if (res.ok) {
        setCart({});
        // تأیید هیبریدی: اگر زیرِ سقف بود سفارش همین حالا قطعی شده. گفتنِ «رزرو ثبت شد»
        // به نماینده‌ای که سفارشش تأیید شده، او را بی‌دلیل منتظرِ تماسِ پشتیبان می‌گذارد.
        const { autoApproved } = await res.json().catch(() => ({ autoApproved: null }));
        setMsg(autoApproved
          ? { kind: "ok", text: `سفارش شما تأیید شد و برای آماده‌سازی رفت — نیازی به تأیید پشتیبان نبود (${formatMoney(autoApproved.orderValue, ctx.currencyUnit)} — ${formatMoneyWords(autoApproved.orderValue, ctx.currencyUnit)}).` }
          : { kind: "ok", text: "رزرو ثبت شد و در انتظار تأیید پشتیبان است." });
        await loadLots(ctx); // همگام‌سازیِ نمایشی بعد از موفقیت
      } else if (res.status === 409) {
        const c = await res.json();
        // پیام دقیق wireframe ۴/spec ۱۱.۵
        setMsg({ kind: "err", text: `این مقدار همین الان توسط نماینده‌ی دیگه رزرو شد. موجودی فعلی: ${c.available} کارتن.` });
        await loadLots(ctx);
      } else if (res.status === 403) {
        setMsg({ kind: "err", text: "دسترسی مجاز نیست." });
      } else {
        setMsg({ kind: "err", text: "خطا در ثبت رزرو." });
      }
    } catch {
      // پاسخ نرسید — شاید سرور پردازش کرده باشد؛ کلید برای تلاشِ بعدی نگه داشته می‌شود.
      setMsg({ kind: "err", text: "ارتباط با سرور برقرار نشد." });
    } finally {
      setPending(false);
    }
  }

  if (state === "none")
    return (
      <main>
        <div className="banner banner--error" role="alert">
          <Icon name="alert" />
          <span>این کاربر به نمایندگی‌ای وصل نیست. اگر پشتیبان هستی، <Link href="/staff">به پنل پشتیبان برو</Link>.</span>
        </div>
      </main>
    );
  if (!ctx) return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>موجودی قابل‌سفارش</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName} — {ctx.agentLegalName}</p>
        </div>
        <nav>
          <ContextSwitcher contexts={contexts} ctx={ctx} onSelect={select} mode="agent" />
          <Link href="/reservations">رزروهای من</Link>
          <Link href="/catalogs">کاتالوگ‌ها</Link>
          <Link href="/account/password">امنیت حساب</Link>
          <LogoutButton />
        </nav>
      </div>

      {loadErr && (
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>{loadErr} فهرست ناقص است.</span>
        </div>
      )}
      {/* یک جایِ ثابت برای همه‌ی پیام‌ها — چه از دکمه‌ی ثبت باشد چه از «خبرم کن»/نوبت
          که پایینِ صفحه‌اند؛ اگر پیام همان‌جا پایین بماند، بدونِ اسکرول دیده نمی‌شود. */}
      <MessageBanner msg={msg} />
      {loaded && !loadErr && lots.length === 0 && <p className="empty">فعلاً کالای قابل‌سفارشی نیست.</p>}

      {/* جستجو/فیلتر (spec ۱۱.۲) — فقط وقتی فهرست به‌اندازه‌ای هست که ارزش داشته باشد.
          با ۲–۳ کالا، جعبه‌ی جستجو فقط جا می‌گیرد. */}
      {loaded && !loadErr && lots.length > 4 && (
        <div className="row row--start" style={{ marginBottom: "var(--sp-3)", flexWrap: "wrap" }}>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="جستجو: نام، کد، شید، کالیبر…" aria-label="جستجوی کالا"
                 style={{ maxWidth: 260, flex: 1 }} />
          {warehouses.length > 1 && (
            <select aria-label="فیلتر انبار" value={whFilter}
                    onChange={(e) => setWhFilter(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="">همه‌ی انبارها</option>
              {warehouses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          )}
          {/* فیلترِ ساخت‌یافته بر ویژگی — پشتِ toggle، چون قبل از دیدنِ اولین کالا
              روی موبایل جا می‌گرفت. اگر از قبل فیلترِ فعالی روی این‌ها هست، باز می‌ماند. */}
          {(["color", "glaze", "punch", "body"] as const).some((k) => attrOpts[k].length > 1) && (
            <button type="button" className="ghost" onClick={() => setShowMoreFilters((s) => !s)}
                    aria-expanded={showMoreFilters || !!attrActive}>
              {showMoreFilters || attrActive ? "فیلترهای کمتر" : "فیلترهای بیشتر (رنگ، لعاب، پانچ، بدنه)"}
            </button>
          )}
          {(showMoreFilters || attrActive) && ([["color", "رنگ"], ["glaze", "لعاب"], ["punch", "پانچ"], ["body", "بدنه"]] as const).map(([k, lbl]) => {
            if (attrOpts[k].length <= 1) return null;
            // مقدارِ الان‌انتخاب‌شده همیشه در گزینه‌ها می‌ماند، حتی اگر جستجو ردش کند —
            // وگرنه select بصری‌اش به «همه‌ی...» برمی‌گردد ولی فیلتر همچنان فعال می‌ماند:
            // state و UI ناهماهنگ می‌شوند و کاربر فکر می‌کند فیلتر پاک شده.
            const opts = attrOpts[k].filter((v) => v === attr[k] || matches(attrSearch[k], [v]));
            return (
              <span key={k} className="row row--start" style={{ gap: ".3rem", flexWrap: "wrap" }}>
                {attrOpts[k].length > 8 && (
                  <input type="search" value={attrSearch[k]}
                         onChange={(e) => setAttrSearch((s) => ({ ...s, [k]: e.target.value }))}
                         placeholder={`جستجوی ${lbl}…`} aria-label={`جستجو در گزینه‌های ${lbl}`}
                         style={{ maxWidth: 120 }} />
                )}
                <select aria-label={`فیلتر ${lbl}`} value={attr[k]}
                        onChange={(e) => setAttr((a) => ({ ...a, [k]: e.target.value }))} style={{ maxWidth: 160 }}>
                  <option value="">همه‌ی {lbl}‌ها</option>
                  {opts.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </span>
            );
          })}
          {(query || whFilter || attrActive) && (
            <span className="row row--start" style={{ gap: "var(--sp-2)" }}>
              <span className="subtle">{money(visibleLots.length)} از {money(lots.length)}</span>
              <button className="ghost" onClick={() => {
                setQuery(""); setWhFilter("");
                setAttr({ color: "", glaze: "", punch: "", body: "" });
                setAttrSearch({ color: "", glaze: "", punch: "", body: "" });
              }}>
                پاک‌کردنِ فیلترها
              </button>
            </span>
          )}
        </div>
      )}
      {/* فیلترِ انبار حتی وقتی فهرست کوتاه است اگر بیش از یک انبار باشد */}
      {loaded && !loadErr && lots.length > 1 && lots.length <= 4 && warehouses.length > 1 && (
        <div className="row row--start" style={{ marginBottom: "var(--sp-3)" }}>
          <label htmlFor="wh-filter" style={{ margin: 0 }}>انبار</label>
          <select id="wh-filter" value={whFilter} onChange={(e) => setWhFilter(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">همه‌ی انبارها</option>
            {warehouses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
      )}
      {loaded && !loadErr && lots.length > 0 && visibleLots.length === 0 && (
        <p className="empty">
          {query ? `چیزی با «${query}» پیدا نشد.` : attrActive ? "چیزی با این فیلترها پیدا نشد." : "در این انبار کالای قابل‌سفارشی نیست."}
        </p>
      )}

      {visibleLots.map((l) => {
        const bpp = l.boxes_per_pallet ?? 0;
        // ارقامِ فارسی همه‌جا، نه فقط در عددِ اصلی: «۱۳۵ کارتن (1 پالت + 15 کارتن)»
        // در یک خط دو الفبای عددی داشت.
        const pallets = bpp > 0
          ? `${money(Math.floor(l.available / bpp))} پالت + ${money(l.available % bpp)} کارتن`
          : null;
        // شفافیت رند (wireframe/spec ۱۰): عدد واقعی متراژ، فقط اگه sqcm_per_box داشته باشیم
        const meters = l.sqcm_per_box
          ? (l.available * l.sqcm_per_box / 10000).toLocaleString("fa-IR", { maximumFractionDigits: 2 })
          : null;
        return (
          <div className="card" key={l.lot_id}>
            {/* عکس thumbnail کنارِ اطلاعات، نه تمام‌عرض: کارتِ سفارش است نه ویترینِ
                محض، و ورودیِ تعداد نباید زیرِ عکسِ بزرگ گم شود. کلیک → مودالِ بزرگ. */}
            <div className="lot-head">
              {/* تامنیل همیشه هست و کلیک‌پذیر — حتی بدونِ عکس — تا پاپ‌آپِ جزئیات باز شود */}
              <button className={l.image_url ? "thumb" : "thumb thumb--empty"} onClick={() => openPreview(l)}
                      aria-label={`جزئیاتِ ${l.name}`}>
                {l.image_url
                  ? <Image onError={hideOnError} src={l.image_url} alt={l.name} loading="lazy" width={88} height={88} />
                  : <Icon name="info" size={20} />}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row">
                  {/* نام کلیک‌پذیر است: کلیک روی محصول = پاپ‌آپِ جزئیات */}
                  <button className="link-plain" onClick={() => openPreview(l)}><strong>{l.name}</strong></button>
                  <span className="badge"><Icon name="warehouse" size={13} />{l.warehouse_name}</span>
                </div>
                <div className="subtle">{l.code}{l.grade ? ` — درجه ${l.grade}` : ""}
                  {l.shade_code ? ` · شید ${l.shade_code}` : ""}{l.caliber_code ? ` · کالیبر ${l.caliber_code}` : ""}
                </div>
                <div className="row row--start" style={{ marginTop: "var(--sp-2)", gap: "var(--sp-4)" }}>
                  <span>
                    <span className="metric">{money(l.available)}</span> <span className="muted">کارتن قابل‌سفارش</span>
                    {pallets ? <span className="subtle"> ({pallets})</span> : null}
                    {meters ? <span className="subtle"> · {meters} متر</span> : null}
                  </span>
                </div>
                <div className="muted">
                  {l.unitPrice !== null
                    ? <>قیمت من: <span className="metric">{formatMoney(l.unitPrice, ctx.currencyUnit)}</span> / کارتن</>
                    : "قیمتی برای شما ثبت نشده"}
                </div>
              </div>
            </div>

            <QtyPicker id={`qty-${l.lot_id}`} label={`تعداد برای ${l.name} در ${l.warehouse_name}`}
                       max={l.available} boxesPerPallet={l.boxes_per_pallet} sqcmPerBox={l.sqcm_per_box}
                       value={cart[l.lot_id] ?? 0}
                       onChange={(boxes) => setCart((c) => ({ ...c, [l.lot_id]: boxes }))} />
          </div>
        );
      })}

      {items.length > 0 && (
        <CartSummary itemCount={items.length} cartBoxes={cartBoxes} cartValue={cartValue} anyUnpriced={anyUnpriced}
          mixedShade={mixedShade} mixedWarehouse={mixedWarehouse} cartWarehouses={cartWarehouses}
          pending={pending} onSubmit={submit} currencyUnit={ctx.currencyUnit} />
      )}

      <OutOfStockSection outOfStock={outOfStock} subscribed={subscribed} queue={queue} queueQty={queueQty}
        alertPending={alertPending} queuePending={queuePending} subs={subs} arrivals={arrivals}
        onToggleAlert={toggleAlert} onJoinQueue={joinQueue} onLeaveQueue={leaveQueue}
        onQueueQtyChange={(variantId, v) => setQueueQty((q) => ({ ...q, [variantId]: v }))}
        currencyUnit={ctx.currencyUnit} />

      {/* مودالِ جزئیاتِ محصول: گالری + ویژگی‌ها + توضیحات. کلیک روی پس‌زمینه یا Esc می‌بندد. */}
      {preview && (
        <ImageGalleryModal title={preview.name}
          gallery={preview.images.length ? preview.images.map((i) => i.url) : preview.image_url ? [preview.image_url] : []}
          activeIndex={galleryIdx} onSelectIndex={setGalleryIdx} onClose={() => setPreviewId(null)}>
          <div className="stack" style={{ marginTop: "var(--sp-3)" }}>
            <div className="row"><span className="muted">کد</span><span className="num">{preview.code}</span></div>
            {preview.color && <div className="row"><span className="muted">رنگ</span><span>{preview.color}</span></div>}
            {preview.glaze && <div className="row"><span className="muted">لعاب</span><span>{preview.glaze}</span></div>}
            {preview.punch && <div className="row"><span className="muted">پانچ</span><span>{preview.punch}</span></div>}
            {preview.body && <div className="row"><span className="muted">بدنه</span><span>{preview.body}</span></div>}
            {preview.size && <div className="row"><span className="muted">ابعاد</span><span>{preview.size}</span></div>}
            {preview.thickness && <div className="row"><span className="muted">ضخامت</span><span>{preview.thickness}</span></div>}
            {preview.usage_area && <div className="row"><span className="muted">کاربری</span><span>{preview.usage_area}</span></div>}
            {preview.grade && <div className="row"><span className="muted">درجه</span><span>{preview.grade}</span></div>}
            {preview.shade_code && <div className="row"><span className="muted">شید</span><span>{preview.shade_code}</span></div>}
            {preview.caliber_code && <div className="row"><span className="muted">کالیبر</span><span>{preview.caliber_code}</span></div>}
            <div className="row">
              <span className="muted">قابل‌سفارش</span>
              <span className="metric">{money(preview.available)} کارتن</span>
            </div>
            {preview.unitPrice !== null && (
              <div className="row">
                <span className="muted">قیمت من</span>
                <span className="metric">{formatMoney(preview.unitPrice, ctx.currencyUnit)} / کارتن</span>
              </div>
            )}
          </div>
          {preview.description && (
            <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
              <div className="muted" style={{ marginBottom: "var(--sp-1)" }}>توضیحات</div>
              <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{preview.description}</p>
            </div>
          )}
        </ImageGalleryModal>
      )}
    </main>
  );
}
