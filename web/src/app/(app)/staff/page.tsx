"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellIcon, BellOffIcon, SearchIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, LoadingState, Notice } from "@/components/states";
import { actionError, getJson, loadError, postJson } from "@/lib/api";
import { useContexts, type Ctx } from "@/lib/useContexts";
import { BackorderTable, NewBackorderDialog, type NewBackorder } from "./backorders";
import { DispatchTable, Lane, RequestTable, ReservationTable } from "./queue";
import {
  num, type Agent, type Backorder, type DashboardKpis, type Disp, type DispatchExtra, type Req, type Resv, type Variant,
} from "./shared";

/**
 * کارتابل پشتیبان (فاز ۶). کار روزانه سه مرحله است و هر سه با هم در تب اول دیده می‌شوند:
 * تأیید رزرو ← ساخت حواله ← بارگیری. فهرست کامل حواله‌ها و کالای ناموجود در تب‌های جدا هستند تا
 * فرم و جستجوی آن‌ها مسیر روزانه را شلوغ نکند.
 */

/** صف رزرو و درخواست را هر چند وقت دوباره بخوان، همان الگوی «رزروهای من» نماینده. */
const QUEUE_REFRESH_MS = 60_000;
const MUTE_KEY = "tile.staffAlertMuted";

/** بوق کوتاه دوتُنی با Web Audio، بدون فایل صوتی. مرورگر بدون تعامل قبلی اجازه نمی‌دهد؛ آن‌وقت فقط بی‌صداست. */
function playChime() {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      const start = now + i * 0.14;
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.2, start + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
      o.connect(g); g.connect(ctx.destination);
      o.start(start); o.stop(start + 0.32);
    });
    void ctx.close();
  } catch { /* اعلان بصری کافی است */ }
}

const isActiveDispatch = (d: Disp) => d.status === "registered" || d.status === "ready_for_loading";

export default function StaffPage() {
  const { ctx, state } = useContexts("staff");
  if (state === "none")
    return <div className="p-4"><Notice tone="error">این بخش فقط برای پشتیبان است.</Notice></div>;
  if (!ctx) return <div className="p-4"><LoadingState /></div>;
  return <AppShell ctx={ctx}><WorkQueue ctx={ctx} /></AppShell>;
}

function WorkQueue({ ctx }: { ctx: Ctx }) {
  const [resvs, setResvs] = useState<Resv[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  // آخرین حواله‌ها بدون جستجو؛ ستون «بارگیری» از این ساخته می‌شود، جدا از فهرست قابل‌جستجوی تب حواله‌ها.
  const [recent, setRecent] = useState<Disp[]>([]);
  const [recentHasMore, setRecentHasMore] = useState(false);
  const [disps, setDisps] = useState<Disp[]>([]);
  const [dispsQ, setDispsQ] = useState("");
  const [dispsHasMore, setDispsHasMore] = useState(false);
  const [dispsBusy, setDispsBusy] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [backorders, setBackorders] = useState<Backorder[]>([]);
  const [boQ, setBoQ] = useState("");
  const [boHasMore, setBoHasMore] = useState(false);
  const [boBusy, setBoBusy] = useState(false);
  const [kpis, setKpis] = useState<DashboardKpis | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState("queue");

  // اعلان رزرو و درخواست تازه: شناسه‌های دیده‌شده بین دو بار خواندن
  const knownResv = useRef<Set<string> | null>(null);
  const knownReq = useRef<Set<string> | null>(null);
  const [newArrivals, setNewArrivals] = useState(0);
  const [freshResv, setFreshResv] = useState<Set<string>>(new Set());
  const [freshReq, setFreshReq] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(() => {
    try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
  });
  // ref، نه وابستگی useCallback: وگرنه هر بار زدن دکمه‌ی صدا load() کامل (۷ GET) را دوباره اجرا می‌کرد.
  const mutedRef = useRef(muted);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // نسخه‌ی درخواست فعلی هر فهرست: پاسخ جستجوی قدیمی که بعد از جستجوی تازه‌تر برسد نادیده گرفته می‌شود.
  const dispsGen = useRef(0);
  const boGen = useRef(0);
  const dispsDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tenantId = ctx.tenantId;

  const fetchDispatches = useCallback((q: string, offset: number) =>
    getJson<{ dispatches: Disp[]; hasMore: boolean }>(
      `/api/sales-dispatches?tenantId=${tenantId}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`), [tenantId]);
  const fetchBackorders = useCallback((q: string, offset: number) =>
    getJson<{ items: Backorder[]; hasMore: boolean }>(
      `/api/backorders?tenantId=${tenantId}&offset=${offset}${q ? `&q=${encodeURIComponent(q)}` : ""}`), [tenantId]);

  /** notify=false (بار اول یا بعد از کار خود کاربر) فقط خط مبنا می‌گذارد؛ notify=true هر شناسه‌ی تازه را هایلایت و بوق می‌زند. */
  const applyQueue = useCallback((rv: Resv[], rq: Req[], notify: boolean) => {
    const fResv = new Set<string>(), fReq = new Set<string>();
    if (notify && knownResv.current) for (const r of rv) if (!knownResv.current.has(r.id)) fResv.add(r.id);
    if (notify && knownReq.current) for (const r of rq) if (!knownReq.current.has(r.id)) fReq.add(r.id);
    knownResv.current = new Set(rv.map((r) => r.id));
    knownReq.current = new Set(rq.map((r) => r.id));
    setResvs(rv); setReqs(rq);
    const fresh = fResv.size + fReq.size;
    if (fresh > 0) {
      setFreshResv(fResv); setFreshReq(fReq);
      setNewArrivals((c) => c + fresh);
      if (!mutedRef.current) playChime();
    }
  }, []);

  const load = useCallback(async () => {
    const myD = ++dispsGen.current, myB = ++boGen.current;
    const [rv, rq, d, ag, cat, bo, kp] = await Promise.all([
      getJson<{ reservations: Resv[] }>(`/api/reservations?tenantId=${tenantId}`),
      getJson<{ requests: Req[] }>(`/api/sales-requests?tenantId=${tenantId}&status=approved`),
      fetchDispatches("", 0),
      getJson<{ agents: Agent[] }>(`/api/agents?tenantId=${tenantId}`),
      getJson<{ variants: Variant[] }>(`/api/catalog?tenantId=${tenantId}`),
      fetchBackorders("", 0),
      getJson<DashboardKpis>(`/api/dashboard?tenantId=${tenantId}`),
    ]);
    if (rv.ok && rq.ok) applyQueue(rv.data.reservations, rq.data.requests, false);
    else { if (rv.ok) setResvs(rv.data.reservations); if (rq.ok) setReqs(rq.data.requests); }
    if (d.ok) {
      setRecent(d.data.dispatches); setRecentHasMore(d.data.hasMore);
      // بعد از هر کار، فهرست تب حواله‌ها به نمای پیش‌فرض برمی‌گردد
      if (myD === dispsGen.current) { setDisps(d.data.dispatches); setDispsHasMore(d.data.hasMore); setDispsQ(""); }
    }
    if (ag.ok) setAgents(ag.data.agents);
    if (cat.ok) setVariants(cat.data.variants);
    if (bo.ok && myB === boGen.current) { setBackorders(bo.data.items); setBoHasMore(bo.data.hasMore); setBoQ(""); }
    if (kp.ok) setKpis(kp.data); // KPI فقط خلاصه است؛ شکستش کل صفحه را خطا نشان نمی‌دهد
    // هر شکست صریح دیده شود، وگرنه صفحه «چیزی نیست» می‌گوید در حالی که نگرفته
    const failed = [rv, rq, d, ag, cat, bo].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, [tenantId, fetchDispatches, fetchBackorders, applyQueue]);

  useEffect(() => { void load(); }, [load]);

  // load() کامل صدا زده نمی‌شود: جستجوی کاربر را پاک می‌کرد و چهار endpoint بی‌لزوم را هم می‌خواند.
  const poll = useCallback(async () => {
    const [rv, rq] = await Promise.all([
      getJson<{ reservations: Resv[] }>(`/api/reservations?tenantId=${tenantId}`),
      getJson<{ requests: Req[] }>(`/api/sales-requests?tenantId=${tenantId}&status=approved`),
    ]);
    if (rv.ok && rq.ok) applyQueue(rv.data.reservations, rq.data.requests, true);
    else { if (rv.ok) setResvs(rv.data.reservations); if (rq.ok) setReqs(rq.data.requests); }
  }, [tenantId, applyQueue]);

  useEffect(() => {
    const iv = setInterval(() => void poll(), QUEUE_REFRESH_MS);
    return () => clearInterval(iv);
  }, [poll]);

  /**
   * هر نوشتن از این می‌گذرد: شکست صریح نشان داده می‌شود و فهرست در هر حال تازه می‌شود.
   * پیام خطا برگردانده می‌شود ("" یعنی موفق) تا دیالوگ باز آن را جلوی پرده نشان دهد؛ بنر صفحه پشت
   * دیالوگ است و Radix آن را از صفحه‌خوان هم پنهان می‌کند.
   */
  async function act(key: string, url: string, body: unknown): Promise<string> {
    setPending(key); setActionErr(""); setNote("");
    try {
      const res = await postJson(url, { tenantId, ...(body as object) });
      const err = res.ok ? "" : actionError(res.status);
      setActionErr(err);
      if (res.ok && key.startsWith("dispatch:")) {
        // سفارش دوانباره دو حواله می‌سازد؛ پشتیبان باید بداند، وگرنه دنبال حواله‌ی دوم می‌گردد.
        const ids = (res.data as { dispatchIds?: string[] }).dispatchIds ?? [];
        if (ids.length > 1) setNote(`این سفارش از ${num(ids.length)} انبار تأمین می‌شود، پس ${num(ids.length)} حواله‌ی جدا ساخته شد.`);
      }
      await load();
      return err;
    } finally { setPending(null); }
  }

  const approve = (id: string) => void act("approve" + id, `/api/reservations/${id}/approve`, {});
  const cancelResv = (id: string) => void act("cancel" + id, `/api/reservations/${id}/cancel`, {});
  const advance = (id: string, toStatus: string) => void act(id + toStatus, `/api/sales-dispatches/${id}/status`, { toStatus });
  const advanceBo = (id: string, toStatus: string) => void act("bo" + id + toStatus, `/api/backorders/${id}/status`, { toStatus });
  // پیشوند «dispatch:» پیام چندحواله‌ای را روشن می‌کند؛ rowPending پایین آن را برای قفل همان ردیف برمی‌دارد.
  const makeDispatch = (requestId: string, extra: DispatchExtra) =>
    act("dispatch:" + requestId, "/api/sales-dispatches", { salesRequestId: requestId, ...extra });
  const createBackorder = (b: NewBackorder) => act("bo-create", "/api/sales-dispatches", {
    agentAccountId: b.agentAccountId, items: [{ variantId: b.variantId, quantityBoxes: b.quantityBoxes }],
    destination: b.destination, customerId: b.customerId, referenceNumber: b.referenceNumber,
  });

  function searchDispatches(v: string) {
    setDispsQ(v);
    if (dispsDebounce.current) clearTimeout(dispsDebounce.current);
    const mine = ++dispsGen.current;
    dispsDebounce.current = setTimeout(() => void (async () => {
      const res = await fetchDispatches(v, 0);
      if (mine === dispsGen.current && res.ok) { setDisps(res.data.dispatches); setDispsHasMore(res.data.hasMore); }
    })(), 300);
  }
  async function moreDispatches() {
    const mine = ++dispsGen.current;
    setDispsBusy(true);
    try {
      const res = await fetchDispatches(dispsQ, disps.length);
      if (mine === dispsGen.current && res.ok) { setDisps((p) => [...p, ...res.data.dispatches]); setDispsHasMore(res.data.hasMore); }
    } finally { if (mine === dispsGen.current) setDispsBusy(false); }
  }
  function searchBackorders(v: string) {
    setBoQ(v);
    if (boDebounce.current) clearTimeout(boDebounce.current);
    const mine = ++boGen.current;
    boDebounce.current = setTimeout(() => void (async () => {
      const res = await fetchBackorders(v, 0);
      if (mine === boGen.current && res.ok) { setBackorders(res.data.items); setBoHasMore(res.data.hasMore); }
    })(), 300);
  }
  async function moreBackorders() {
    const mine = ++boGen.current;
    setBoBusy(true);
    try {
      const res = await fetchBackorders(boQ, backorders.length);
      if (mine === boGen.current && res.ok) { setBackorders((p) => [...p, ...res.data.items]); setBoHasMore(res.data.hasMore); }
    } finally { if (mine === boGen.current) setBoBusy(false); }
  }

  const toLoad = recent.filter(isActiveDispatch);
  const queueCount = resvs.length + reqs.length + toLoad.length;
  // «چیزی نیست» فقط وقتی راست است که بارگذاری موفق بوده؛ با خطا شمارش و پیام خالی نشان داده نمی‌شود.
  const failed = !!loadErr;
  // pendingِ ساخت حواله با کلید «dispatch:id» ثبت می‌شود؛ جدول با id خام مقایسه می‌کند
  const rowPending = pending?.startsWith("dispatch:") ? pending.slice(9) : pending;

  return (
    <div className="grid grid-cols-1 gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="me-auto">
          <h1 className="text-xl font-bold">کارتابل</h1>
          <p className="text-sm text-muted-foreground">{ctx.tenantName}</p>
        </div>
        <Button variant="outline" size="sm" aria-pressed={!muted}
          onClick={() => setMuted((m) => { const next = !m; try { localStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch { /* حالت خصوصی */ } return next; })}>
          {muted ? <BellOffIcon /> : <BellIcon />}{muted ? "صدای اعلان خاموش" : "صدای اعلان روشن"}
        </Button>
      </header>

      {kpis && (
        <dl className="grid grid-cols-2 gap-2 md:grid-cols-[1fr_1fr_2fr]">
          <Stat label="حواله‌ی امروز" value={num(kpis.todayDispatches)} />
          <Stat label="کارتن بارگیری‌شده‌ی امروز" value={num(kpis.todayBoxes)} />
          <div className="col-span-2 rounded-xl border bg-card px-3 py-2.5 md:col-span-1">
            <dt className="text-xs text-muted-foreground">رو به اتمام</dt>
            <dd className="mt-1 text-sm">
              {kpis.lowStock.length === 0 ? <span className="text-muted-foreground">کالای کم‌موجودی نیست.</span>
                : kpis.lowStock.map((v) => `${v.name} (${v.code}): ${num(v.available)}`).join("، ")}
            </dd>
          </div>
        </dl>
      )}

      {newArrivals > 0 && (
        <Notice tone="warning" action={<Button size="xs" variant="outline" onClick={() => setNewArrivals(0)}>دیدم</Button>}>
          {num(newArrivals)} رزرو یا درخواست تازه رسید؛ ردیف‌های «تازه» را ببینید.
        </Notice>
      )}
      {loadErr && <Notice tone="error">{loadErr} فهرست‌ها ناقص یا خالی‌اند؛ به «چیزی نیست» اعتماد نکنید.</Notice>}
      {actionErr && <Notice tone="error">{actionErr}</Notice>}
      {note && <Notice tone="success">{note}</Notice>}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b pb-1">
          <TabsTrigger value="queue" className="flex-none">صف کار{loaded && !failed && <span className="tabular-nums text-muted-foreground"> ({num(queueCount)})</span>}</TabsTrigger>
          <TabsTrigger value="dispatches" className="flex-none">همه‌ی حواله‌ها</TabsTrigger>
          <TabsTrigger value="backorders" className="flex-none">کالای ناموجود</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="grid grid-cols-1 gap-3 pt-2">
          {!loaded ? <LoadingState /> : (
            <>
              <Lane title="۱. تأیید رزرو" count={resvs.length} failed={failed} empty="رزروی برای تأیید نیست.">
                <ReservationTable rows={resvs} fresh={freshResv} pending={pending} onApprove={approve} onCancel={cancelResv} />
              </Lane>
              <Lane title="۲. ساخت حواله" count={reqs.length} failed={failed} empty="درخواست تأییدشده‌ای منتظر حواله نیست.">
                <RequestTable rows={reqs} fresh={freshReq} tenantId={tenantId} pending={rowPending} onMakeDispatch={makeDispatch} />
              </Lane>
              <Lane title="۳. بارگیری" count={toLoad.length} failed={failed} empty="حواله‌ای منتظر بارگیری نیست."
                hint={recentHasMore ? `از ${num(recent.length)} حواله‌ی اخیر؛ قدیمی‌ترها در «همه‌ی حواله‌ها»` : undefined}>
                <DispatchTable rows={toLoad} pending={pending} onAdvance={advance} label="حواله‌های منتظر بارگیری" testId="to-load" />
              </Lane>
            </>
          )}
        </TabsContent>

        <TabsContent value="dispatches" className="grid grid-cols-1 gap-3 pt-2">
          <SearchBox label="جستجوی حواله" placeholder="کد حواله، مشتری، نمایندگی…" value={dispsQ} onChange={searchDispatches} />
          {!loaded ? <LoadingState /> : disps.length === 0 ? (
            !loadErr && <EmptyState>{dispsQ ? "چیزی پیدا نشد." : "حواله‌ای نیست."}</EmptyState>
          ) : (
            <div className="rounded-xl border bg-card p-1 max-md:border-0 max-md:bg-transparent max-md:p-0">
              <DispatchTable rows={disps} pending={pending} onAdvance={advance} label="حواله‌ها" testId="dispatch-list" />
            </div>
          )}
          {dispsHasMore && <Button variant="outline" onClick={() => void moreDispatches()} pending={dispsBusy}>بیشتر</Button>}
        </TabsContent>

        <TabsContent value="backorders" className="grid grid-cols-1 gap-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox label="جستجوی کالای ناموجود" placeholder="کالا، کد، نمایندگی، کد حواله…" value={boQ} onChange={searchBackorders} />
            <NewBackorderDialog tenantId={tenantId} agents={agents} variants={variants} pending={pending === "bo-create"} onSubmit={createBackorder} />
          </div>
          {!loaded ? <LoadingState /> : backorders.length === 0 ? (
            !loadErr && <EmptyState>{boQ ? "چیزی پیدا نشد." : "کالای ناموجودی ثبت نشده."}</EmptyState>
          ) : (
            <div className="rounded-xl border bg-card p-1 max-md:border-0 max-md:bg-transparent max-md:p-0">
              <BackorderTable rows={backorders} pending={pending} onAdvance={advanceBo} />
            </div>
          )}
          {boHasMore && <Button variant="outline" onClick={() => void moreBackorders()} pending={boBusy}>بیشتر</Button>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card px-3 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-bold tabular-nums">{value}</dd>
    </div>
  );
}

function SearchBox({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative min-w-0 flex-1">
      <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="ps-8" />
    </div>
  );
}
