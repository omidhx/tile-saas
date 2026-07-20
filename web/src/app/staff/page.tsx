"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getJson, loadError } from "@/lib/api";
import LogoutButton from "../LogoutButton";

type Ctx = { tenantId: string; tenantName: string };
type Resv = { id: string; status: string; agentName: string; items: { name: string; code: string; quantityBoxes: number }[] };
type Req = { id: string; status: string; agentName: string; items: { name: string; code: string; qty: number }[] };
type Disp = { id: string; dispatchCode: string; status: string; customerName: string | null; items: number };
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

  async function createBackorder() {
    if (!ctx || !boAgent || !boVariant || Number(boQty) <= 0) return;
    setPending("bo-create");
    try {
      await fetch("/api/sales-dispatches", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: ctx.tenantId, agentAccountId: boAgent, dispatchCode: `BO-${Date.now()}`,
          items: [{ variantId: boVariant, quantityBoxes: Number(boQty) }],
        }),
      });
      setBoQty("");
      await load(ctx);
    } finally { setPending(null); }
  }

  async function advanceBackorder(itemId: string, toStatus: string) {
    if (!ctx) return;
    setPending("bo" + itemId + toStatus);
    try {
      await fetch(`/api/backorders/${itemId}/status`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ctx.tenantId, toStatus }),
      });
      await load(ctx);
    } finally { setPending(null); }
  }

  async function approve(reservationId: string) {
    if (!ctx) return;
    setPending("approve" + reservationId);
    try {
      await fetch(`/api/reservations/${reservationId}/approve`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ctx.tenantId }),
      });
      await load(ctx);
    } finally { setPending(null); }
  }

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
    setPending(requestId);
    try {
      await fetch("/api/sales-dispatches", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ctx.tenantId, salesRequestId: requestId, dispatchCode: `D-${Date.now()}` }),
      });
      await load(ctx);
    } finally { setPending(null); }
  }

  async function advance(dispatchId: string, toStatus: string) {
    if (!ctx) return;
    setPending(dispatchId + toStatus);
    try {
      await fetch(`/api/sales-dispatches/${dispatchId}/status`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ctx.tenantId, toStatus }),
      });
      await load(ctx);
    } finally { setPending(null); }
  }

  if (!ctx) return <main><p className="muted">در حال بارگذاری…</p></main>;

  return (
    <main>
      <div className="row"><h1>پنل پشتیبان</h1><span style={{ display: "flex", gap: ".75rem", alignItems: "center" }}><a href="/staff/import" className="muted">ورود موجودی از اکسل ←</a><LogoutButton /></span></div>
      <p className="muted">{ctx.tenantName}</p>

      {loadErr && (
        <div className="card"><span className="err">⚠️ {loadErr} فهرست‌های زیر ناقص یا خالی‌اند — به «چیزی نیست» اعتماد نکن.</span></div>
      )}

      <h2 style={{ fontSize: "1.05rem" }}>رزروهای در انتظار تأیید</h2>
      {loaded && !loadErr && pendingResvs.length === 0 && <p className="muted">رزروِ فعالی برای تأیید نیست.</p>}
      {pendingResvs.map((r) => (
        <div className="card" key={r.id}>
          <div className="row"><strong>{r.agentName}</strong></div>
          <div className="muted">{r.items.map((i) => `${i.name} ×${i.quantityBoxes}`).join("، ")}</div>
          <div style={{ marginTop: ".5rem" }}>
            <button onClick={() => approve(r.id)} disabled={pending === "approve" + r.id}>
              {pending === "approve" + r.id && <span className="spinner" />}تأیید (held→allocated)
            </button>
          </div>
        </div>
      ))}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>درخواست‌های تأییدشده</h2>
      {loaded && !loadErr && reqs.length === 0 && <p className="muted">درخواست تأییدشده‌ای برای حواله نیست.</p>}
      {reqs.map((r) => (
        <div className="card" key={r.id}>
          <div className="row"><strong>{r.agentName}</strong></div>
          <div className="muted">{r.items.map((i) => `${i.name} ×${i.qty}`).join("، ")}</div>
          <div style={{ marginTop: ".5rem" }}>
            <button onClick={() => makeDispatch(r.id)} disabled={pending === r.id}>
              {pending === r.id && <span className="spinner" />}ساخت حواله
            </button>
          </div>
        </div>
      ))}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>حواله‌ها</h2>
      {loaded && !loadErr && disps.length === 0 && <p className="muted">حواله‌ای نیست.</p>}
      {disps.map((d) => (
        <div className="card" key={d.id}>
          <div className="row"><strong>{d.dispatchCode}</strong><span className="muted">{FA[d.status] ?? d.status} · {d.items} قلم</span></div>
          {d.customerName && <div className="muted">{d.customerName}</div>}
          <div className="row" style={{ marginTop: ".5rem", justifyContent: "flex-start", gap: ".5rem" }}>
            {(NEXT[d.status] ?? []).map((s) => (
              <button key={s} className={s === "cancelled" ? "ghost" : undefined}
                onClick={() => advance(d.id, s)} disabled={pending === d.id + s}>
                {pending === d.id + s && <span className="spinner" />}{FA[s]}
              </button>
            ))}
          </div>
        </div>
      ))}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>Backorder (محصول ناموجود)</h2>
      <div className="card">
        <label>ثبت backorder جدید</label>
        <div className="row" style={{ gap: ".5rem", flexWrap: "wrap", justifyContent: "flex-start" }}>
          <select value={boAgent} onChange={(e) => setBoAgent(e.target.value)}
            style={{ padding: ".5rem", borderRadius: 8, border: "1px solid var(--line)" }}>
            <option value="">نمایندگی…</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.legalName}</option>)}
          </select>
          <select value={boVariant} onChange={(e) => setBoVariant(e.target.value)}
            style={{ padding: ".5rem", borderRadius: 8, border: "1px solid var(--line)" }}>
            <option value="">کالا…</option>
            {variants.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
          </select>
          <input type="number" min={1} placeholder="کارتن" value={boQty}
            onChange={(e) => setBoQty(e.target.value)} style={{ maxWidth: 100 }} />
          <button onClick={createBackorder} disabled={pending === "bo-create" || !boAgent || !boVariant || Number(boQty) <= 0}>
            {pending === "bo-create" && <span className="spinner" />}ثبت
          </button>
        </div>
      </div>
      {loaded && !loadErr && backorders.length === 0 && <p className="muted">backorderی نیست.</p>}
      {backorders.map((b) => (
        <div className="card" key={b.id}>
          <div className="row">
            <strong>{b.name} ({b.code}) ×{b.qty}</strong>
            <span className="muted">{BO_FA[b.status] ?? b.status}</span>
          </div>
          <div className="muted">{b.agentName} · {b.dispatchCode}</div>
          <div className="row" style={{ marginTop: ".5rem", justifyContent: "flex-start", gap: ".5rem" }}>
            {(BO_NEXT[b.status] ?? []).map((s) => (
              <button key={s} className={s === "cancelled" ? "ghost" : undefined}
                onClick={() => advanceBackorder(b.id, s)} disabled={pending === "bo" + b.id + s}>
                {pending === "bo" + b.id + s && <span className="spinner" />}{BO_FA[s]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </main>
  );
}
