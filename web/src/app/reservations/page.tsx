"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Ctx = { tenantId: string; agentAccountId: string; tenantName: string; agentLegalName: string };
type Item = { name: string; code: string; quantityBoxes: number };
type Resv = { id: string; status: string; expiresAt: string; items: Item[] };

const STATUS_FA: Record<string, string> = {
  active: "فعال", converted: "تأییدشده", expired: "منقضی", cancelled: "لغوشده",
};

export default function MyReservationsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [rows, setRows] = useState<Resv[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async (c: Ctx) => {
    const res = await fetch(`/api/reservations?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`);
    if (res.ok) setRows((await res.json()).reservations);
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

  async function approve(id: string) {
    if (!ctx) return;
    setMsg(null);
    setPending(id);
    try {
      const res = await fetch(`/api/reservations/${id}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId }),
      });
      if (res.ok) { setMsg("رزرو تأیید و به درخواست فروش تبدیل شد."); await load(ctx); }
      else if (res.status === 409) setMsg("این رزرو دیگر قابل تأیید نیست (منقضی یا قبلاً تبدیل‌شده).");
      else setMsg("خطا در تأیید.");
    } finally { setPending(null); }
  }

  const remaining = (iso: string) => {
    const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    return min <= 0 ? "منقضی" : min < 60 ? `${min} دقیقه` : `${Math.floor(min / 60)} ساعت`;
  };

  if (!ctx) return <main><p className="muted">در حال بارگذاری…</p></main>;

  return (
    <main>
      <div className="row"><h1>رزروهای من</h1><Link href="/reserve" className="muted">+ رزرو جدید</Link></div>
      <p className="muted">{ctx.tenantName} — {ctx.agentLegalName}</p>
      {rows.length === 0 && <p className="muted">رزروی نداری.</p>}
      {rows.map((r) => (
        <div className="card" key={r.id}>
          <div className="row">
            <span>{STATUS_FA[r.status] ?? r.status}</span>
            {r.status === "active" && <span className="muted">⏳ {remaining(r.expiresAt)}</span>}
          </div>
          <div className="muted">{r.items.map((i) => `${i.name} (${i.code}) ×${i.quantityBoxes}`).join("، ")}</div>
          {r.status === "active" && (
            <div style={{ marginTop: ".5rem" }}>
              <button onClick={() => approve(r.id)} disabled={pending === r.id}>
                {pending === r.id && <span className="spinner" />}
                {pending === r.id ? "در حال تأیید…" : "تأیید و تبدیل به درخواست فروش"}
              </button>
            </div>
          )}
        </div>
      ))}
      {msg && <p className="muted" style={{ color: "var(--ok)" }}>{msg}</p>}
    </main>
  );
}
