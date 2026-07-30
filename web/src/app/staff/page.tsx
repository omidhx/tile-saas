"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { useContexts, type Ctx } from "@/lib/useContexts";
import Link from "next/link";
import { remainingTime } from "@/lib/date";
import LogoutButton from "../LogoutButton";
import Icon from "../Icon";
import NavMenu from "../NavMenu";

/** ارقامِ فارسی، همه‌جا یکسان. */
const num = (v: number) => v.toLocaleString("fa-IR");
/** معادلِ اعشاری (پالت/مترمربع) — برای دو رقمِ اعشار کافی، نه عددِ صحیح مثلِ کارتن. */
const numUnit = (v: number) => v.toLocaleString("fa-IR", { maximumFractionDigits: 2 });
/** صفِ رزرو/درخواست را هر چند وقت دوباره بخوان — همان الگوی «رزروهای من»ِ نماینده. */
const QUEUE_REFRESH_MS = 60_000;

type ResvItem = {
  name: string; code: string; quantityBoxes: number;
  /** برای نمایشِ معادلِ پالت/مترمربع کنارِ عددِ کارتن — بسته‌بندی مشخصه‌ی ثابتِ محصول است. */
  boxesPerPallet: number | null; sqcmPerBox: number | null;
};
type Resv = { id: string; status: string; expiresAt: string; agentName: string; assignedStaffName: string | null; assignedStaffPhone: string | null; items: ResvItem[] };
type Req = {
  id: string; status: string; agentName: string; approvalMode: "manual" | "auto";
  assignedStaffName: string | null; assignedStaffPhone: string | null;
  items: { name: string; code: string; qty: number }[];
};
type Disp = { id: string; dispatchCode: string; status: string; customerName: string | null; items: number; warehouseName: string | null };
type Agent = { id: string; legalName: string };
type Variant = { id: string; name: string; code: string; sku: string };
type Backorder = { id: string; status: string; qty: number; name: string; code: string; dispatchCode: string; agentName: string };

const NEXT: Record<string, string[]> = {
  registered: ["ready_for_loading", "cancelled"],
  ready_for_loading: ["loaded", "cancelled"],
  loaded: ["delivered"],
  delivered: [], cancelled: [],
};
const FA: Record<string, string> = {
  registered: "ثبت‌شده", ready_for_loading: "آماده بارگیری", loaded: "بارگیری‌شده",
  delivered: "تحویل‌شده", cancelled: "لغوشده",
};
const BO_NEXT: Record<string, string[]> = {
  pending_production: ["ready", "cancelled"], ready: ["fulfilled", "cancelled"], fulfilled: [], cancelled: [],
};
const BO_FA: Record<string, string> = {
  pending_production: "در انتظار تولید", ready: "آماده", fulfilled: "تحویل‌شده", cancelled: "لغوشده",
};

export default function StaffPage() {
  const { ctx, state } = useContexts("staff");
  const [pendingResvs, setPendingResvs] = useState<Resv[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [disps, setDisps] = useState<Disp[]>([]);
  const [dispsQ, setDispsQ] = useState("");
  const [dispsHasMore, setDispsHasMore] = useState(false);
  const [dispsBusy, setDispsBusy] = useState(false);
  const dispsDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [backorders, setBackorders] = useState<Backorder[]>([]);
  const [boListQ, setBoListQ] = useState("");
  const [boHasMore, setBoHasMore] = useState(false);
  const [boBusy, setBoBusy] = useState(false);
  const boListDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [boAgent, setBoAgent] = useState("");
  const [boVariant, setBoVariant] = useState("");
  const [boQty, setBoQty] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);

  /** حواله‌ها و backorderها append-only-اند و فقط بزرگ‌تر می‌شوند — صفحه‌بندی‌شده
   *  می‌آیند تا بعدِ چند ماه کار، تاریخچه‌ی قدیمی زیرِ LIMIT ثابت گم نشود. */
  const fetchDispatches = useCallback((tenantId: string, q: string, offset: number) =>
    getJson<{ dispatches: Disp[]; hasMore: boolean }>(
      `/api/sales-dispatches?tenantId=${tenantId}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`), []);

  const fetchBackorders = useCallback((tenantId: string, q: string, offset: number) =>
    getJson<{ items: Backorder[]; hasMore: boolean }>(
      `/api/backorders?tenantId=${tenantId}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`), []);

  const load = useCallback(async (c: Ctx) => {
    const [rv, r, d, ag, cat, bo] = await Promise.all([
      getJson<{ reservations: Resv[] }>(`/api/reservations?tenantId=${c.tenantId}`), // staff view: active همه
      getJson<{ requests: Req[] }>(`/api/sales-requests?tenantId=${c.tenantId}&status=approved`),
      fetchDispatches(c.tenantId, "", 0),
      getJson<{ agents: Agent[] }>(`/api/agents?tenantId=${c.tenantId}`),
      getJson<{ variants: Variant[] }>(`/api/catalog?tenantId=${c.tenantId}`),
      fetchBackorders(c.tenantId, "", 0),
    ]);
    if (rv.ok) setPendingResvs(rv.data.reservations);
    if (r.ok) setReqs(r.data.requests);
    // اکشن یعنی «برگرد به نمای پیش‌فرض» — جستجوی فعال هم همین‌جا ریست می‌شود
    if (d.ok) { setDisps(d.data.dispatches); setDispsHasMore(d.data.hasMore); setDispsQ(""); }
    if (ag.ok) setAgents(ag.data.agents);
    if (cat.ok) setVariants(cat.data.variants);
    if (bo.ok) { setBackorders(bo.data.items); setBoHasMore(bo.data.hasMore); setBoListQ(""); }
    // هر شکستی را صریح نشان بده — وگرنه صفحه «چیزی برای تأیید نیست» می‌گوید در حالی که نگرفته
    const failed = [rv, r, d, ag, cat, bo].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, [fetchDispatches, fetchBackorders]);

  function searchDispatches(v: string) {
    setDispsQ(v);
    if (dispsDebounce.current) clearTimeout(dispsDebounce.current);
    dispsDebounce.current = setTimeout(async () => {
      if (!ctx) return;
      const res = await fetchDispatches(ctx.tenantId, v, 0);
      if (res.ok) { setDisps(res.data.dispatches); setDispsHasMore(res.data.hasMore); }
    }, 300);
  }

  async function loadMoreDispatches() {
    if (!ctx) return;
    setDispsBusy(true);
    try {
      const res = await fetchDispatches(ctx.tenantId, dispsQ, disps.length);
      if (res.ok) { setDisps((prev) => [...prev, ...res.data.dispatches]); setDispsHasMore(res.data.hasMore); }
    } finally { setDispsBusy(false); }
  }

  function searchBackorders(v: string) {
    setBoListQ(v);
    if (boListDebounce.current) clearTimeout(boListDebounce.current);
    boListDebounce.current = setTimeout(async () => {
      if (!ctx) return;
      const res = await fetchBackorders(ctx.tenantId, v, 0);
      if (res.ok) { setBackorders(res.data.items); setBoHasMore(res.data.hasMore); }
    }, 300);
  }

  async function loadMoreBackorders() {
    if (!ctx) return;
    setBoBusy(true);
    try {
      const res = await fetchBackorders(ctx.tenantId, boListQ, backorders.length);
      if (res.ok) { setBackorders((prev) => [...prev, ...res.data.items]); setBoHasMore(res.data.hasMore); }
    } finally { setBoBusy(false); }
  }

  /** هر عملِ نوشتن از این عبور می‌کند: شکست را صریح نشان می‌دهد، نه اینکه فقط
   *  load() صدا بزند و رزروِ تأییدنشده را همان‌جا بگذارد. note هم اینجا پاک
   *  می‌شود — وگرنه پیامِ موفقیتِ یک عملِ قبلی (مثلاً «۲ حواله ساخته شد») روی
   *  عملِ کاملاً نامرتبطِ بعدی هم می‌ماند. */
  async function act(key: string, url: string, body: unknown, method: "POST" | "PATCH" = "POST") {
    if (!ctx) return false;
    setPending(key); setActionErr(""); setNote("");
    try {
      const res = await postJson(url, body, method);
      if (!res.ok) { setActionErr(actionError(res.status)); }
      await load(ctx); // چه موفق چه ناموفق: فهرست را تازه کن تا وضعیتِ واقعی دیده شود
      return res.ok;
    } finally { setPending(null); }
  }

  async function createBackorder() {
    if (!ctx || !boAgent || !boVariant || Number(boQty) <= 0) return;
    const ok = await act("bo-create", "/api/sales-dispatches", {
      tenantId: ctx.tenantId, agentAccountId: boAgent,
      items: [{ variantId: boVariant, quantityBoxes: Number(boQty) }],
    });
    if (ok) setBoQty("");
  }

  const advanceBackorder = (itemId: string, toStatus: string) =>
    act("bo" + itemId + toStatus, `/api/backorders/${itemId}/status`, { tenantId: ctx!.tenantId, toStatus });

  // بدون agentAccountId → مسیرِ staff (هر رزروِ این tenant)
  const cancelResv = (reservationId: string) =>
    act("cancel" + reservationId, `/api/reservations/${reservationId}/cancel`, { tenantId: ctx!.tenantId });

  const approve = (reservationId: string) =>
    act("approve" + reservationId, `/api/reservations/${reservationId}/approve`, { tenantId: ctx!.tenantId });

  useEffect(() => { if (ctx) load(ctx); }, [ctx, load]);

  /**
   * صفِ «رزروهای در انتظار تأیید» و «درخواست‌های تأییدشده» بدونِ این فقط با
   * F5ِ دستیِ پشتیبان تازه می‌شد — رزروِ تازه‌ی نماینده تا رفرشِ بعدی (شاید فردا)
   * دیده نمی‌شد، برخلافِ «رزروهای من»ِ نماینده که از اول polling داشت.
   * عمداً `load()` کامل را صدا نمی‌زند: آن هم جستجوی حواله/backorder را ریست
   * می‌کند (رفتارِ درستِ بعدِ یک اکشن، نه چیزی که هر ۶۰ ثانیه بی‌خبر اتفاق بیفتد)
   * و هم چهار endpointِ غیرضروری (نمایندگی‌ها/کاتالوگ/حواله/backorder) را دوباره می‌گیرد.
   */
  const pollQueues = useCallback(async (c: Ctx) => {
    const [rv, r] = await Promise.all([
      getJson<{ reservations: Resv[] }>(`/api/reservations?tenantId=${c.tenantId}`),
      getJson<{ requests: Req[] }>(`/api/sales-requests?tenantId=${c.tenantId}&status=approved`),
    ]);
    if (rv.ok) setPendingResvs(rv.data.reservations);
    if (r.ok) setReqs(r.data.requests);
  }, []);

  useEffect(() => {
    if (!ctx) return;
    const iv = setInterval(() => pollQueues(ctx), QUEUE_REFRESH_MS);
    return () => clearInterval(iv);
  }, [ctx, pollQueues]);

  async function makeDispatch(requestId: string) {
    if (!ctx) return;
    setPending(requestId); setActionErr(""); setNote("");
    try {
      const res = await postJson("/api/sales-dispatches",
        { tenantId: ctx.tenantId, salesRequestId: requestId });
      if (!res.ok) setActionErr(actionError(res.status));
      else {
        // سفارشِ دوانباره دو حواله می‌سازد — پشتیبان باید بداند، وگرنه دنبالِ حواله‌ی
        // دومی می‌گردد که فکر می‌کند ساخته نشده.
        const ids = (res.data as { dispatchIds?: string[] }).dispatchIds ?? [];
        if (ids.length > 1)
          setNote(`این سفارش از ${num(ids.length)} انبار تأمین می‌شود، پس ${num(ids.length)} حواله‌ی جدا ساخته شد.`);
      }
      await load(ctx);
    } finally { setPending(null); }
  }

  const advance = (dispatchId: string, toStatus: string) =>
    act(dispatchId + toStatus, `/api/sales-dispatches/${dispatchId}/status`, { tenantId: ctx!.tenantId, toStatus });

  if (state === "none")
    return (
      <main>
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>این بخش فقط برای پشتیبان است.</span>
        </div>
      </main>
    );
  if (!ctx) return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;

  return (
    <main className="wide">
      <div className="topbar">
        <div>
          <h1>پنل پشتیبان</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        {/* ده لینکِ تخت روی موبایل می‌پیچید و روی دسکتاپ هم نویز بود.
            «خروج» عمداً بیرونِ منو ماند: یک عملِ پرتکرار پشتِ یک کلیکِ اضافه نرود. */}
        <nav>
          <NavMenu ctx={ctx} />
          <LogoutButton />
        </nav>
      </div>

      {loadErr && (
        <div className="banner banner--error" role="alert">
          <Icon name="alert" />
          <span>{loadErr} فهرست‌های زیر ناقص یا خالی‌اند — به «چیزی نیست» اعتماد نکن.</span>
        </div>
      )}
      {actionErr && (
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>{actionErr}</span>
        </div>
      )}
      {note && (
        <div className="banner banner--ok" role="status">
          <Icon name="check" /><span>{note}</span>
        </div>
      )}

      {/* دو ستون: راست = کارهایی که منتظرِ تصمیم‌اند، چپ = چیزهایی که پیگیری می‌شوند */}
      <div className="cols">
      <div className="col">

      {/* صفِ کار: چیزی که پشتیبان برای آن وارد شده، پس اول می‌آید و شمارشش
          روی تیتر است تا بدون اسکرول معلوم باشد چقدر کار مانده. */}
      <h2>
        رزروهای در انتظار تأیید
        {pendingResvs.length > 0 && <span className="badge badge--warn">{num(pendingResvs.length)}</span>}
      </h2>
      {loaded && !loadErr && pendingResvs.length === 0 && <p className="empty">رزروِ فعالی برای تأیید نیست.</p>}
      {pendingResvs.map((r) => {
        // مهلتِ باقی‌مانده تا انقضا — صف حالا با همین ترتیب دارد (زودترین انقضا اول)،
        // پس دیدنِ خودِ عدد هم لازم است، وگرنه ترتیب بی‌توضیح می‌ماند.
        const rem = remainingTime(r.expiresAt);
        return (
        <div className="card" key={r.id}>
          <div className="row">
            <strong>{r.agentName}</strong>
            <span className="row row--start" style={{ gap: "var(--sp-2)" }}>
              {/* پشتیبانِ ثابت: پورسانتِ این سفارش دستِ کیست — هر staffی که صف را می‌بیند باید بداند */}
              {(r.assignedStaffName || r.assignedStaffPhone) && (
                <span className="subtle">پشتیبان: {r.assignedStaffName ?? r.assignedStaffPhone}</span>
              )}
              <span className={rem.low ? "err" : "subtle"} style={{ display: "inline-flex", gap: ".3em", alignItems: "center" }}>
                <Icon name="clock" size={13} />{rem.text}{!rem.low ? " مانده" : ""}
              </span>
            </span>
          </div>
          <div className="muted">
            {/* معادلِ پالت/مترمربع کنارِ هر قلم — سنجشِ سریعِ سفارش‌های بزرگ بدونِ محاسبه‌ی ذهنی */}
            {r.items.map((i, idx) => (
              <span key={idx}>
                {idx > 0 && "، "}
                {i.name} ×{num(i.quantityBoxes)}
                {(i.boxesPerPallet || i.sqcmPerBox) && (
                  <span className="subtle">
                    {" ("}
                    {i.boxesPerPallet && `${numUnit(i.quantityBoxes / i.boxesPerPallet)} پالت`}
                    {i.boxesPerPallet && i.sqcmPerBox && "، "}
                    {i.sqcmPerBox && `${numUnit((i.quantityBoxes * i.sqcmPerBox) / 10000)} مترمربع`}
                    {")"}
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
            <button className="primary" onClick={() => approve(r.id)}
              disabled={pending === "approve" + r.id} aria-busy={pending === "approve" + r.id}>
              {pending === "approve" + r.id && <span className="spinner" aria-hidden="true" />}تأیید
            </button>
            <button className="ghost" onClick={() => cancelResv(r.id)}
              disabled={pending === "cancel" + r.id} aria-busy={pending === "cancel" + r.id}>
              {pending === "cancel" + r.id && <span className="spinner" aria-hidden="true" />}لغو
            </button>
          </div>
        </div>
        );
      })}

      <h2>
        درخواست‌های تأییدشده
        {reqs.length > 0 && <span className="badge">{num(reqs.length)}</span>}
      </h2>
      {loaded && !loadErr && reqs.length === 0 && <p className="empty">درخواست تأییدشده‌ای برای حواله نیست.</p>}
      {reqs.map((r) => (
        <div className="card" key={r.id}>
          <div className="row">
            <strong>{r.agentName}</strong>
            <span className="row row--start" style={{ gap: "var(--sp-2)" }}>
              {(r.assignedStaffName || r.assignedStaffPhone) && (
                <span className="subtle">پشتیبان: {r.assignedStaffName ?? r.assignedStaffPhone}</span>
              )}
              {/* پشتیبان باید ببیند کدام سفارش بدونِ او تأیید شده — وگرنه فیچر بی‌سروصدا کار می‌کند */}
              {r.approvalMode === "auto" && <span className="badge badge--ok">تأیید خودکار (زیر سقف)</span>}
            </span>
          </div>
          <div className="muted">{r.items.map((i) => `${i.name} ×${num(i.qty)}`).join("، ")}</div>
          <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
            <button onClick={() => makeDispatch(r.id)} disabled={pending === r.id} aria-busy={pending === r.id}>
              {pending === r.id && <span className="spinner" aria-hidden="true" />}ساخت حواله
            </button>
          </div>
        </div>
      ))}

      </div>{/* /col — کارهای در انتظار تصمیم */}
      <div className="col">

      <h2>حواله‌ها</h2>
      <input type="search" aria-label="جستجوی حواله" placeholder="جستجو: کدِ حواله، مشتری، نمایندگی…"
        value={dispsQ} onChange={(e) => searchDispatches(e.target.value)} style={{ marginBottom: "var(--sp-3)" }} />
      {loaded && !loadErr && disps.length === 0 && <p className="empty">{dispsQ ? "چیزی پیدا نشد." : "حواله‌ای نیست."}</p>}
      {disps.map((d) => (
        <div className="card" key={d.id}>
          <div className="row">
            <strong className="num">{d.dispatchCode}</strong>
            <span className="row row--start" style={{ gap: "var(--sp-1)" }}>
              {/* انبار badge است نه متن: انباردار باید با یک نگاه بفهمد این حواله مالِ اوست */}
              {d.warehouseName && <span className="badge"><Icon name="warehouse" size={13} />{d.warehouseName}</span>}
              <span className={`badge${d.status === "delivered" || d.status === "loaded" ? " badge--ok" : d.status === "cancelled" ? " badge--error" : ""}`}>
                {FA[d.status] ?? d.status}
              </span>
              <span className="subtle">{num(d.items)} قلم</span>
            </span>
          </div>
          {d.customerName && <div className="muted">{d.customerName}</div>}
          <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
            {(NEXT[d.status] ?? []).map((s) => (
              <button key={s} className={s === "cancelled" ? "danger" : s === "loaded" ? "primary" : undefined}
                onClick={() => advance(d.id, s)} disabled={pending === d.id + s} aria-busy={pending === d.id + s}>
                {pending === d.id + s && <span className="spinner" aria-hidden="true" />}{FA[s]}
              </button>
            ))}
            {/* انباردار روی کاغذ کار می‌کند نه صفحه‌نمایش — لینکِ برگه‌ی چاپی همیشه در دسترس است، حتی حواله‌ی نهایی‌شده */}
            <Link href={`/staff/dispatch/${d.id}/print`} target="_blank">
              <button type="button"><Icon name="printer" size={13} />چاپ</button>
            </Link>
          </div>
        </div>
      ))}
      {dispsHasMore && (
        <button onClick={loadMoreDispatches} aria-busy={dispsBusy} disabled={dispsBusy} style={{ width: "100%" }}>
          {dispsBusy && <span className="spinner" aria-hidden="true" />}بیشتر
        </button>
      )}

      <h2>Backorder (محصول ناموجود)</h2>
      <div className="card">
        <label htmlFor="bo-agent">ثبت backorder جدید</label>
        <div className="row row--start" style={{ gap: "var(--sp-2)" }}>
          <select id="bo-agent" aria-label="نمایندگی" value={boAgent} onChange={(e) => setBoAgent(e.target.value)}
            style={{ maxWidth: 200 }}>
            <option value="">نمایندگی…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.legalName}</option>)}
          </select>
          <select aria-label="کالا" value={boVariant} onChange={(e) => setBoVariant(e.target.value)}
            style={{ maxWidth: 240 }}>
            <option value="">کالا…</option>
            {variants.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
          </select>
          <input type="number" min={1} placeholder="کارتن" aria-label="تعداد کارتن" value={boQty}
            onChange={(e) => setBoQty(e.target.value)} style={{ maxWidth: 110 }} />
          <button onClick={createBackorder} aria-busy={pending === "bo-create"}
            disabled={pending === "bo-create" || !boAgent || !boVariant || Number(boQty) <= 0}>
            {pending === "bo-create" && <span className="spinner" aria-hidden="true" />}ثبت
          </button>
        </div>
      </div>
      <input type="search" aria-label="جستجوی backorder" placeholder="جستجو: کالا، کد، نمایندگی، کدِ حواله…"
        value={boListQ} onChange={(e) => searchBackorders(e.target.value)} style={{ marginBottom: "var(--sp-3)" }} />
      {loaded && !loadErr && backorders.length === 0 && <p className="empty">{boListQ ? "چیزی پیدا نشد." : "backorderی نیست."}</p>}
      {backorders.map((b) => (
        <div className="card" key={b.id}>
          <div className="row">
            <strong>{b.name} <span className="subtle">{b.code}</span> ×{num(b.qty)}</strong>
            <span className={`badge${b.status === "fulfilled" ? " badge--ok" : b.status === "cancelled" ? " badge--error" : " badge--warn"}`}>
              {BO_FA[b.status] ?? b.status}
            </span>
          </div>
          <div className="muted">{b.agentName} · <span className="num">{b.dispatchCode}</span></div>
          <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
            {(BO_NEXT[b.status] ?? []).map((s) => (
              <button key={s} className={s === "cancelled" ? "danger" : s === "fulfilled" ? "primary" : undefined}
                onClick={() => advanceBackorder(b.id, s)} disabled={pending === "bo" + b.id + s}
                aria-busy={pending === "bo" + b.id + s}>
                {pending === "bo" + b.id + s && <span className="spinner" aria-hidden="true" />}{BO_FA[s]}
              </button>
            ))}
          </div>
        </div>
      ))}
      {boHasMore && (
        <button onClick={loadMoreBackorders} aria-busy={boBusy} disabled={boBusy} style={{ width: "100%" }}>
          {boBusy && <span className="spinner" aria-hidden="true" />}بیشتر
        </button>
      )}

      </div>{/* /col — پیگیری */}
      </div>{/* /cols */}
    </main>
  );
}
