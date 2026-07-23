"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { useContexts, type Ctx } from "@/lib/useContexts";
import ContextSwitcher from "../ContextSwitcher";
import LogoutButton from "../LogoutButton";
import Icon from "../Icon";
import { formatJalaliDate } from "@/lib/date";
import { matches, normalize } from "@/lib/search";

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

type WaitlistEntry = { variantId: string; name: string; code: string; quantityBoxes: number; position: number };

type Arrival = { quantityBoxes: number; expectedAt: string; status: "planned" | "confirmed" };

type Substitute = {
  variantId: string; name: string; code: string; grade: string | null;
  available: number; unitPrice: number | null; note: string | null;
  source: "explicit" | "same_product";
};

// پول در دیتابیس عددِ صحیح است؛ اعشار/جداکننده فقط همین‌جا در لایه‌ی UI (قانون #۷)
const money = (v: number) => v.toLocaleString("fa-IR");
const fmtUnit = (n: number) => n.toLocaleString("fa-IR", { maximumFractionDigits: 2 });

type Unit = "box" | "pallet" | "sqm";

/**
 * ورودیِ تعداد با انتخابِ واحد (کارتن/پالت/مترمربع). بسته‌بندی مشخصه‌ی ثابتِ
 * کارخانه است (پشتیبان در مدیریتِ محصول تنظیمش می‌کند)، پس اینجا فقط تبدیل
 * می‌شود — نه چیزی که نماینده هر بار حدس بزند.
 *
 * منبعِ حقیقت همیشه `value` (کارتن، در cart) است؛ `text` فقط بازنمودِ محلیِ
 * واحدِ انتخاب‌شده است تا کاربر بتواند اعشار تایپ کند بدونِ فرمت‌شدنِ هر keystroke.
 * اگر تبدیل به سقفِ موجودی بخورد، متن با معادلِ واقعی جایگزین می‌شود — وگرنه
 * عددِ نمایش‌داده‌شده با آنچه واقعاً رزرو می‌شود فرق می‌کرد.
 */
function QtyPicker({
  id, label, max, boxesPerPallet, sqcmPerBox, value, onChange,
}: {
  id: string; label: string; max: number;
  boxesPerPallet: number | null; sqcmPerBox: number | null;
  value: number; onChange: (boxes: number) => void;
}) {
  const [unit, setUnit] = useState<Unit>("box");
  const [text, setText] = useState(value > 0 ? String(value) : "");
  const hasFactor = boxesPerPallet != null || sqcmPerBox != null;

  // بعدِ صفرشدنِ سبد از بیرون (مثلاً ثبتِ موفقِ سفارش)، ورودیِ محلی هم پاک شود
  useEffect(() => { if (value === 0) setText(""); }, [value]);

  function toBoxes(n: number, u: Unit): number {
    if (u === "box") return Math.floor(n);
    if (u === "pallet") return Math.ceil(n * (boxesPerPallet ?? 0));
    return Math.ceil((n * 10000) / (sqcmPerBox || 1));
  }

  function commit(raw: string, u: Unit) {
    setText(raw);
    const n = Number(normalize(raw).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) { onChange(0); return; }
    const boxes = toBoxes(n, u);
    const clamped = Math.max(0, Math.min(max, boxes));
    onChange(clamped);
    if (clamped !== boxes) {
      // به سقفِ موجودی خورد — متن باید معادلِ واقعیِ رزروشده را نشان دهد، نه عددِ خام‌تایپ‌شده
      if (u === "box") setText(String(clamped));
      else if (u === "pallet") setText(fmtUnit(clamped / (boxesPerPallet ?? 1)));
      else setText(fmtUnit((clamped * (sqcmPerBox ?? 0)) / 10000));
    }
  }

  function switchUnit(u: Unit) {
    setUnit(u);
    if (value <= 0) { setText(""); return; }
    if (u === "box") setText(String(value));
    else if (u === "pallet") setText(fmtUnit(value / (boxesPerPallet ?? 1)));
    else setText(fmtUnit((value * (sqcmPerBox ?? 0)) / 10000));
  }

  const placeholder = unit === "box" ? "تعداد کارتن" : unit === "pallet" ? "تعداد پالت" : "متراژ (مترمربع)";

  return (
    <div style={{ marginTop: "var(--sp-3)" }}>
      <div className="row row--start" style={{ flexWrap: "wrap" }}>
        <label htmlFor={id} className="sr-only">{label}</label>
        <input id={id} type="text" inputMode="decimal" placeholder={placeholder}
               value={text} style={{ maxWidth: 130 }}
               onChange={(e) => commit(e.target.value, unit)} />
        {hasFactor ? (
          <select aria-label="واحدِ ورود" value={unit} onChange={(e) => switchUnit(e.target.value as Unit)} style={{ maxWidth: 110 }}>
            <option value="box">کارتن</option>
            {boxesPerPallet != null && <option value="pallet">پالت</option>}
            {sqcmPerBox != null && <option value="sqm">مترمربع</option>}
          </select>
        ) : <span className="subtle">کارتن</span>}
      </div>
      {value > 0 && hasFactor && (
        <div className="subtle" style={{ marginTop: "var(--sp-1)" }}>
          معادل: {money(value)} کارتن
          {boxesPerPallet != null && ` · ${fmtUnit(value / boxesPerPallet)} پالت`}
          {sqcmPerBox != null && ` · ${fmtUnit((value * sqcmPerBox) / 10000)} مترمربع`}
        </div>
      )}
    </div>
  );
}

export default function ReservePage() {
  const { contexts, ctx, state, select } = useContexts("agent");
  const [lots, setLots] = useState<Lot[]>([]);
  // ponytail: سبد state محلیه، نه Zustand — یک صفحه‌ست. وقتی سبد چند-route شد، Zustand (spec ۱۱.۴).
  const [cart, setCart] = useState<Record<string, number>>({});
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
  // مودالِ جزئیات + گالری — فقط شناسه نگه‌داشته می‌شود، نه خودِ آبجکت؛ وگرنه اگر
  // lots در پس‌زمینه رفرش شود (مثلاً بعدِ یک عملیاتِ دیگر)، مودال داده‌ی کهنه نشان می‌دهد.
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [galleryIdx, setGalleryIdx] = useState(0);
  const openPreview = (l: Lot) => { setPreviewId(l.lot_id); setGalleryIdx(0); };
  const preview = lots.find((l) => l.lot_id === previewId) ?? null;
  const closeBtnRef = useRef<HTMLButtonElement>(null);
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
    if (lotsRes.ok) setLots(lotsRes.data.lots);
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

  // Esc مودال را می‌بندد — دسترسی‌پذیریِ پایه برای هر دیالوگ
  useEffect(() => {
    if (!previewId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPreviewId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewId]);

  // فوکوس روی دکمه‌ی بستن، همان الگویِ NavMenu — کاربرِ کیبورد مجبور نیست کورکورانه Tab بزند
  useEffect(() => { if (previewId) closeBtnRef.current?.focus(); }, [previewId]);

  const items = Object.entries(cart).filter(([, q]) => q > 0);
  const shades = new Set(items.map(([id]) => lots.find((l) => l.lot_id === id)?.shade_code).filter(Boolean));
  const mixedShade = shades.size > 1; // spec ۷.۲: هشدار نرم، نه منع

  // فهرستِ انبارها از خودِ اقلام ساخته می‌شود، نه یک کوئریِ جدا: انباری که چیزی
  // برای سفارش ندارد، فیلترِ بی‌نتیجه می‌سازد.
  const warehouses = [...new Map(lots.map((l) => [l.warehouse_id, l.warehouse_name])).entries()];

  // مقدارهای یکتای هر ویژگی، فقط از اقلامِ موجود — تا فیلترِ بی‌نتیجه ساخته نشود.
  // دراپ‌داون فقط وقتی نشان داده می‌شود که ۲ مقدار یا بیشتر باشد (یک مقدار فیلترِ بی‌فایده است).
  const distinct = (key: "color" | "glaze" | "punch" | "body") =>
    [...new Set(lots.map((l) => l[key]).filter((v): v is string => !!v))].sort();
  const attrOpts = { color: distinct("color"), glaze: distinct("glaze"), punch: distinct("punch"), body: distinct("body") };
  const attrActive = attr.color || attr.glaze || attr.punch || attr.body;

  // جستجو روی نام/کد/شید/کالیبر (spec ۱۱.۲). نرمال‌سازیِ ارقام و حروف در lib/search.
  const visibleLots = lots.filter((l) =>
    (!whFilter || l.warehouse_id === whFilter)
    && (!attr.color || l.color === attr.color)
    && (!attr.glaze || l.glaze === attr.glaze)
    && (!attr.punch || l.punch === attr.punch)
    && (!attr.body || l.body === attr.body)
    && matches(query, [l.name, l.code, l.grade, l.shade_code, l.caliber_code]));

  // سفارشِ دوانباره ممنوع نیست — فقط دو حواله می‌شود. هشدارِ نرم، مثل شیدِ مخلوط،
  // چون یک کامیون نمی‌تواند از دو انبار بار بزند و نماینده باید از قبل بداند.
  const cartWarehouses = new Set(items.map(([id]) => lots.find((l) => l.lot_id === id)?.warehouse_name).filter(Boolean));
  const mixedWarehouse = cartWarehouses.size > 1;

  // جمعِ زنده‌ی سبد. برای کسی که تلفنی با مشتری هماهنگ می‌کند «الان چقدر شد؟»
  // سؤالِ لحظه‌به‌لحظه است. این فقط برآوردِ نمایشی است — قیمتِ قطعی در لحظه‌ی
  // **تأیید** snapshot می‌شود (تخفیفِ حجمی هم آنجا)، نه اینجا؛ پس صریح «تقریبی»
  // گفته می‌شود تا با فاکتور اشتباه نشود.
  const cartBoxes = items.reduce((s, [, q]) => s + q, 0);
  let cartValue = 0;
  let anyUnpriced = false;
  for (const [id, q] of items) {
    const lot = lots.find((l) => l.lot_id === id);
    if (lot?.unitPrice != null) cartValue += lot.unitPrice * q;
    else anyUnpriced = true;
  }

  async function submit() {
    if (!ctx || items.length === 0) return;
    setMsg(null);
    setPending(true); // pending state، بدون optimistic و بدون refetch-before-submit (spec ۱۱.۱/۱۱.۲)
    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: ctx.tenantId,
          agentAccountId: ctx.agentAccountId,
          idempotencyKey: crypto.randomUUID(),
          items: items.map(([lotId, quantityBoxes]) => ({ lotId, quantityBoxes })),
        }),
      });
      if (res.ok) {
        setCart({});
        // تأیید هیبریدی: اگر زیرِ سقف بود سفارش همین حالا قطعی شده. گفتنِ «رزرو ثبت شد»
        // به نماینده‌ای که سفارشش تأیید شده، او را بی‌دلیل منتظرِ تماسِ پشتیبان می‌گذارد.
        const { autoApproved } = await res.json().catch(() => ({ autoApproved: null }));
        setMsg(autoApproved
          ? { kind: "ok", text: `سفارش شما تأیید شد و برای آماده‌سازی رفت — نیازی به تأیید پشتیبان نبود (${money(autoApproved.orderValue)} ریال).` }
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
      {msg && (
        <div className={`banner banner--${msg.kind === "ok" ? "ok" : "error"}`} role="status">
          <Icon name={msg.kind === "ok" ? "check" : "alert"} /><span>{msg.text}</span>
        </div>
      )}
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
          {/* فیلترِ ساخت‌یافته بر ویژگی — هرکدام فقط اگر ۲ مقدار یا بیشتر داشته باشد.
              اگر گزینه‌ها زیاد شدند (>۸)، یک کادرِ جستجو هم بالای آن می‌آید تا با
              اسکرولِ طولانیِ select پیدا نکردنِ مقدار آزاردهنده نشود. */}
          {([["color", "رنگ"], ["glaze", "لعاب"], ["punch", "پانچ"], ["body", "بدنه"]] as const).map(([k, lbl]) => {
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
                  ? <img src={l.image_url} alt={l.name} loading="lazy" />
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
                    ? <>قیمت من: <span className="metric">{money(l.unitPrice)}</span> ریال / کارتن</>
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
        <div className="card card--raised" style={{ position: "sticky", bottom: "var(--sp-3)" }}>
          <div className="row">
            <strong>سبد رزرو</strong>
            <span className="badge">{money(items.length)} قلم · {money(cartBoxes)} کارتن</span>
          </div>

          {/* جمعِ ریالیِ تقریبی — «تقریبی» چون تخفیفِ حجمی و قیمتِ قطعی در لحظه‌ی تأیید */}
          {cartValue > 0 && (
            <div className="row" style={{ marginTop: "var(--sp-2)" }}>
              <span className="muted">جمعِ تقریبی</span>
              <span className="metric">{money(cartValue)} ریال</span>
            </div>
          )}
          {anyUnpriced && (
            <div className="subtle" style={{ marginTop: "var(--sp-1)" }}>
              بعضی اقلام قیمتِ ثبت‌شده ندارند و در این جمع نیستند — قیمتِ نهایی را پشتیبان تأیید می‌کند.
            </div>
          )}

          {/* هشدارِ نرم، نه منع: تصمیم با نماینده است ولی باید پیامدش را بداند */}
          {mixedShade && (
            <div className="banner banner--warn" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
              <Icon name="alert" /><span>شیدهای متفاوت در سبد — برای یک سطحِ پیوسته توصیه نمی‌شود.</span>
            </div>
          )}
          {mixedWarehouse && (
            <div className="banner banner--warn" style={{ marginTop: "var(--sp-2)", marginBottom: 0 }}>
              <Icon name="warehouse" />
              <span>
                سبد از {money(cartWarehouses.size)} انبار است ({[...cartWarehouses].join("، ")}) — این سفارش به{" "}
                {money(cartWarehouses.size)} حواله‌ی جدا تقسیم می‌شود، چون هر کامیون از یک انبار بار می‌زند.
              </span>
            </div>
          )}

          <div className="row row--stack-mobile" style={{ marginTop: "var(--sp-3)", justifyContent: "flex-start" }}>
            <button className="primary" onClick={submit} disabled={pending} aria-busy={pending}>
              {pending && <span className="spinner" aria-hidden="true" />}
              {pending ? "در حال ثبت…" : "ثبت رزرو (همه یا هیچ)"}
            </button>
          </div>
        </div>
      )}

      {outOfStock.length > 0 && (
        <>
          <h2>ناموجودها</h2>
          {/* دو گزینه‌ی متفاوت که راحت با هم اشتباه می‌شوند، پس تفاوتشان صریح گفته
              می‌شود: یکی فقط خبر می‌دهد، دیگری واقعاً موجودی را نگه می‌دارد. */}
          <div className="banner banner--info">
            <Icon name="info" />
            <span>
              <strong>خبرم کن</strong>: به‌محض موجود شدن یک پیامک می‌گیری — ولی موجودی برایت
              نگه داشته نمی‌شود و هرکس زودتر سفارش دهد می‌برد.<br />
              <strong>نوبت بگیر</strong>: به‌ترتیبِ نوبت، به‌محض آزاد شدن موجودی همان تعداد
              <strong> برایت رزرو می‌شود</strong>.
            </span>
          </div>
          {outOfStock.map((v) => {
            const on = subscribed.includes(v.variantId);
            const q = queue.find((w) => w.variantId === v.variantId);
            const qty = Number(queueQty[v.variantId]);
            return (
              <div className="card" key={v.variantId}>
                <div className="row">
                  <span><strong>{v.name}</strong> <span className="subtle">{v.code}</span></span>
                  <button className={on ? "primary" : "ghost"} disabled={alertPending === v.variantId}
                    aria-busy={alertPending === v.variantId}
                    onClick={() => toggleAlert(v.variantId, !on)}>
                    {alertPending === v.variantId
                      ? <span className="spinner" aria-hidden="true" />
                      : <Icon name="bell" />}
                    {on ? "خبرم بده (فعال)" : "خبرم کن"}
                  </button>
                </div>

                {q ? (
                  <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
                    <span className="badge badge--ok">
                      <Icon name="queue" size={13} />
                      نفر {money(q.position)} · {money(q.quantityBoxes)} کارتن
                    </span>
                    <button className="ghost" disabled={queuePending === v.variantId}
                      aria-busy={queuePending === v.variantId}
                      onClick={() => leaveQueue(v.variantId)}>
                      {queuePending === v.variantId && <span className="spinner" aria-hidden="true" />}
                      انصراف از نوبت
                    </button>
                  </div>
                ) : (
                  <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
                    <label htmlFor={`wl-${v.variantId}`} className="sr-only">تعداد کارتن برای نوبتِ {v.name}</label>
                    <input id={`wl-${v.variantId}`} type="number" min={1} inputMode="numeric" placeholder="تعداد کارتن"
                      style={{ maxWidth: 150 }}
                      value={queueQty[v.variantId] ?? ""}
                      onChange={(e) => setQueueQty({ ...queueQty, [v.variantId]: e.target.value })} />
                    <button disabled={queuePending === v.variantId || !(qty > 0)}
                      aria-busy={queuePending === v.variantId}
                      onClick={() => joinQueue(v.variantId)}>
                      {queuePending === v.variantId && <span className="spinner" aria-hidden="true" />}
                      نوبت بگیر
                    </button>
                  </div>
                )}

                {/* «کِی می‌رسد» — همان چیزی که در v1 کم بود. نماینده باید بتواند بین
                    صبر کردن و گرفتنِ جایگزین انتخاب کند، و بدونِ تاریخ نمی‌تواند. */}
                {(arrivals[v.variantId] ?? []).length > 0 && (
                  <div className="banner banner--info" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
                    <Icon name="clock" />
                    <span>
                      {(arrivals[v.variantId] ?? []).map((a, i) => (
                        <div key={i}>
                          <strong>{money(a.quantityBoxes)} کارتن</strong> در راه —
                          حدودِ {formatJalaliDate(a.expectedAt)}
                          {a.status === "planned"
                            ? <span className="subtle"> (برنامه‌ریزی‌شده، هنوز قطعی نیست)</span>
                            : <span className="subtle"> (قطعی‌شده)</span>}
                        </div>
                      ))}
                    </span>
                  </div>
                )}

                {/* جایگزین‌ها دقیقاً همین‌جا می‌آیند — جایی که نماینده تازه فهمیده
                    کالا نیست. فرستادنش به بالای صفحه برای پیدا کردنِ مشابه، همان
                    فروشی است که از دست می‌رود. */}
                {(subs[v.variantId] ?? []).length > 0 && (
                  <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
                    <div className="muted" style={{ marginBottom: "var(--sp-2)" }}>به‌جایش موجود است:</div>
                    {(subs[v.variantId] ?? []).map((s) => (
                      <div className="row" key={s.variantId} style={{ marginBottom: "var(--sp-2)" }}>
                        <span>
                          <strong>{s.name}</strong> <span className="subtle">{s.code}</span>
                          {s.grade ? <span className="subtle"> · درجه {s.grade}</span> : null}
                          {/* منبعِ پیشنهاد صریح گفته می‌شود: «کارخانه گفته» با
                              «سیستم حدس زده» برای نماینده یکی نیست. */}
                          {s.note
                            ? <div className="subtle">{s.note}</div>
                            : s.source === "same_product"
                              ? <div className="subtle">همین کالا با درجه‌ی دیگر</div>
                              : null}
                        </span>
                        <span style={{ textAlign: "start" }}>
                          <span className="metric">{money(s.available)}</span> <span className="muted">کارتن</span>
                          {s.unitPrice !== null && (
                            <div className="subtle num">{money(s.unitPrice)} ریال / کارتن</div>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {/* مودالِ جزئیاتِ محصول: گالری + ویژگی‌ها + توضیحات. کلیک روی پس‌زمینه یا Esc می‌بندد. */}
      {preview && (() => {
        const gallery = preview.images.length ? preview.images.map((i) => i.url)
          : preview.image_url ? [preview.image_url] : [];
        const main = gallery[galleryIdx] ?? gallery[0];
        return (
        <div className="modal-backdrop" onClick={() => setPreviewId(null)} role="dialog" aria-modal="true"
             aria-label={`جزئیات ${preview.name}`}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <strong>{preview.name}</strong>
              <button ref={closeBtnRef} className="ghost" onClick={() => setPreviewId(null)} aria-label="بستن">✕</button>
            </div>
            {main && <img src={main} alt={preview.name} className="modal-img" />}
            {gallery.length > 1 && (
              <div className="gallery" style={{ marginTop: "var(--sp-2)" }}>
                {gallery.map((u, i) => (
                  <button key={i} className={`gallery-item ${i === galleryIdx ? "gallery-item--primary" : ""}`}
                          onClick={() => setGalleryIdx(i)} aria-label={`عکس ${i + 1}`}>
                    <img src={u} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
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
                  <span className="metric">{money(preview.unitPrice)} ریال / کارتن</span>
                </div>
              )}
            </div>
            {preview.description && (
              <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
                <div className="muted" style={{ marginBottom: "var(--sp-1)" }}>توضیحات</div>
                <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{preview.description}</p>
              </div>
            )}
          </div>
        </div>
        );
      })()}
    </main>
  );
}
