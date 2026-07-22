"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import LogoutButton from "../LogoutButton";
import Icon from "../Icon";
import NavMenu from "../NavMenu";

/** ارقامِ فارسی، همه‌جا یکسان. */
const num = (v: number) => v.toLocaleString("fa-IR");

type Ctx = { tenantId: string; tenantName: string };
type Resv = { id: string; status: string; agentName: string; items: { name: string; code: string; quantityBoxes: number }[] };
type Req = { id: string; status: string; agentName: string; approvalMode: "manual" | "auto"; items: { name: string; code: string; qty: number }[] };
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
  const router = useRouter();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [pendingResvs, setPendingResvs] = useState<Resv[]>([]);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [disps, setDisps] = useState<Disp[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [backorders, setBackorders] = useState<Backorder[]>([]);
  const [boAgent, setBoAgent] = useState("");
  const [boVariant, setBoVariant] = useState("");
  const [boQty, setBoQty] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [actionErr, setActionErr] = useState("");
  const [note, setNote] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (c: Ctx) => {
    const [rv, r, d, ag, cat, bo] = await Promise.all([
      getJson<{ reservations: Resv[] }>(`/api/reservations?tenantId=${c.tenantId}`), // staff view: active همه
      getJson<{ requests: Req[] }>(`/api/sales-requests?tenantId=${c.tenantId}&status=approved`),
      getJson<{ dispatches: Disp[] }>(`/api/sales-dispatches?tenantId=${c.tenantId}`),
      getJson<{ agents: Agent[] }>(`/api/agents?tenantId=${c.tenantId}`),
      getJson<{ variants: Variant[] }>(`/api/catalog?tenantId=${c.tenantId}`),
      getJson<{ items: Backorder[] }>(`/api/backorders?tenantId=${c.tenantId}`),
    ]);
    if (rv.ok) setPendingResvs(rv.data.reservations);
    if (r.ok) setReqs(r.data.requests);
    if (d.ok) setDisps(d.data.dispatches);
    if (ag.ok) setAgents(ag.data.agents);
    if (cat.ok) setVariants(cat.data.variants);
    if (bo.ok) setBackorders(bo.data.items);
    // هر شکستی را صریح نشان بده — وگرنه صفحه «چیزی برای تأیید نیست» می‌گوید در حالی که نگرفته
    const failed = [rv, r, d, ag, cat, bo].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, []);

  /** هر عملِ نوشتن از این عبور می‌کند: شکست را صریح نشان می‌دهد، نه اینکه فقط
   *  load() صدا بزند و رزروِ تأییدنشده را همان‌جا بگذارد. */
  async function act(key: string, url: string, body: unknown, method: "POST" | "PATCH" = "POST") {
    if (!ctx) return false;
    setPending(key); setActionErr("");
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
      tenantId: ctx.tenantId, agentAccountId: boAgent, dispatchCode: `BO-${Date.now()}`,
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

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me");
      if (res.status === 401) { router.push("/login"); return; }
      const { contexts } = await res.json();
      const staffCtx = contexts?.find((c: { role?: string }) => c.role === "staff" || c.role === "admin") ?? contexts?.[0];
      if (!staffCtx) return;
      setCtx(staffCtx);
      load(staffCtx);
    })();
  }, [router, load]);

  async function makeDispatch(requestId: string) {
    if (!ctx) return;
    setPending(requestId); setActionErr("");
    try {
      const res = await postJson("/api/sales-dispatches",
        { tenantId: ctx.tenantId, salesRequestId: requestId, dispatchCode: `D-${Date.now()}` });
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
          <NavMenu />
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
      {pendingResvs.map((r) => (
        <div className="card" key={r.id}>
          <div className="row"><strong>{r.agentName}</strong></div>
          <div className="muted">{r.items.map((i) => `${i.name} ×${num(i.quantityBoxes)}`).join("، ")}</div>
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
      ))}

      <h2>
        درخواست‌های تأییدشده
        {reqs.length > 0 && <span className="badge">{num(reqs.length)}</span>}
      </h2>
      {loaded && !loadErr && reqs.length === 0 && <p className="empty">درخواست تأییدشده‌ای برای حواله نیست.</p>}
      {reqs.map((r) => (
        <div className="card" key={r.id}>
          <div className="row">
            <strong>{r.agentName}</strong>
            {/* پشتیبان باید ببیند کدام سفارش بدونِ او تأیید شده — وگرنه فیچر بی‌سروصدا کار می‌کند */}
            {r.approvalMode === "auto" && <span className="badge badge--ok">تأیید خودکار (زیر سقف)</span>}
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
      {loaded && !loadErr && disps.length === 0 && <p className="empty">حواله‌ای نیست.</p>}
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
          </div>
        </div>
      ))}

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
      {loaded && !loadErr && backorders.length === 0 && <p className="empty">backorderی نیست.</p>}
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

      </div>{/* /col — پیگیری */}
      </div>{/* /cols */}
    </main>
  );
}
