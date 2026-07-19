"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Ctx = { tenantId: string; tenantName: string };
type Req = { id: string; status: string; agentName: string; items: { name: string; code: string; qty: number }[] };
type Disp = { id: string; dispatchCode: string; status: string; customerName: string | null; items: number };

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

export default function StaffPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [reqs, setReqs] = useState<Req[]>([]);
  const [disps, setDisps] = useState<Disp[]>([]);
  const [pending, setPending] = useState<string | null>(null);

  const load = useCallback(async (c: Ctx) => {
    const [r, d] = await Promise.all([
      fetch(`/api/sales-requests?tenantId=${c.tenantId}&status=approved`),
      fetch(`/api/sales-dispatches?tenantId=${c.tenantId}`),
    ]);
    if (r.ok) setReqs((await r.json()).requests);
    if (d.ok) setDisps((await d.json()).dispatches);
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me");
      if (res.status === 401) { router.push("/login"); return; }
      const { contexts } = await res.json();
      if (!contexts?.length) return;
      setCtx(contexts[0]);
      load(contexts[0]);
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
      <h1>پنل پشتیبان</h1>
      <p className="muted">{ctx.tenantName}</p>

      <h2 style={{ fontSize: "1.05rem" }}>درخواست‌های تأییدشده</h2>
      {reqs.length === 0 && <p className="muted">درخواست تأییدشده‌ای برای حواله نیست.</p>}
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
      {disps.length === 0 && <p className="muted">حواله‌ای نیست.</p>}
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
    </main>
  );
}
