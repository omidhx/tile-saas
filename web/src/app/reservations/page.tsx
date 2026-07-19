"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Ctx = { tenantId: string; agentAccountId: string; tenantName: string; agentLegalName: string };
type Item = { name: string; code: string; quantityBoxes: number };
type Resv = { id: string; status: string; expiresAt: string; items: Item[] };

const STATUS_FA: Record<string, string> = {
  active: "فعال (در انتظار تأیید پشتیبان)", converted: "تأییدشده", expired: "منقضی", cancelled: "لغوشده",
};

export default function MyReservationsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [rows, setRows] = useState<Resv[]>([]);
  const [notAgent, setNotAgent] = useState(false);

  const load = useCallback(async (c: Ctx) => {
    const res = await fetch(`/api/reservations?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`);
    if (res.ok) setRows((await res.json()).reservations);
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me");
      if (res.status === 401) { router.push("/login"); return; }
      const { contexts } = await res.json();
      const agentCtx = contexts?.find((c: Ctx) => c.agentAccountId); // staff نماینده نیست
      if (!agentCtx) { setNotAgent(true); return; }
      setCtx(agentCtx);
      load(agentCtx);
    })();
  }, [router, load]);

  const remaining = (iso: string) => {
    const min = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
    return min <= 0 ? "منقضی" : min < 60 ? `${min} دقیقه` : `${Math.floor(min / 60)} ساعت`;
  };

  if (notAgent) return <main><p className="err">این کاربر به نمایندگی‌ای وصل نیست. اگر پشتیبان هستی، به پنل پشتیبان برو.</p></main>;
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
        </div>
      ))}
    </main>
  );
}
