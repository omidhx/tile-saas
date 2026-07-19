"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import LogoutButton from "../LogoutButton";

type Ctx = { tenantId: string; agentAccountId: string; agentLegalName: string; tenantName: string };
type Lot = {
  lot_id: string; name: string; code: string; grade: string | null;
  shade_code: string | null; caliber_code: string | null;
  available: number; boxes_per_pallet: number | null; sqcm_per_box: number | null;
};

export default function ReservePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [lots, setLots] = useState<Lot[]>([]);
  // ponytail: سبد state محلیه، نه Zustand — یک صفحه‌ست. وقتی سبد چند-route شد، Zustand (spec ۱۱.۴).
  const [cart, setCart] = useState<Record<string, number>>({});
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [subscribed, setSubscribed] = useState<string[]>([]);
  const [outOfStock, setOutOfStock] = useState<{ variantId: string; name: string; code: string }[]>([]);
  const [alertPending, setAlertPending] = useState<string | null>(null);

  const loadLots = useCallback(async (c: Ctx) => {
    const [lotsRes, alertsRes] = await Promise.all([
      fetch(`/api/lots?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`),
      fetch(`/api/alerts?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`),
    ]);
    if (lotsRes.ok) setLots((await lotsRes.json()).lots);
    if (alertsRes.ok) {
      const a = await alertsRes.json();
      setSubscribed(a.subscribed);
      setOutOfStock(a.outOfStock);
    }
  }, []);

  async function toggleAlert(variantId: string, on: boolean) {
    if (!ctx) return;
    setAlertPending(variantId);
    try {
      await fetch("/api/alerts", {
        method: on ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId, variantId }),
      });
      await loadLots(ctx);
    } finally { setAlertPending(null); }
  }

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me");
      if (res.status === 401) { router.push("/login"); return; }
      const { contexts } = await res.json();
      // کاربرِ staff agentAccountId نداره — این صفحه مالِ نماینده‌ست
      const agentCtx = contexts?.find((c: Ctx) => c.agentAccountId);
      if (!agentCtx) { setMsg({ kind: "err", text: "این کاربر به نمایندگی‌ای وصل نیست. اگر پشتیبان هستی، به پنل پشتیبان برو." }); return; }
      setCtx(agentCtx); // انتخاب context ساده؛ سوییچر چند-نمایندگی: بعداً
      loadLots(agentCtx);
    })();
  }, [router, loadLots]);

  const items = Object.entries(cart).filter(([, q]) => q > 0);
  const shades = new Set(items.map(([id]) => lots.find((l) => l.lot_id === id)?.shade_code).filter(Boolean));
  const mixedShade = shades.size > 1; // spec ۷.۲: هشدار نرم، نه منع

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
        setMsg({ kind: "ok", text: "رزرو با موفقیت ثبت شد." });
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

  if (!ctx) return <main><p className="muted">در حال بارگذاری…</p>{msg && <p className="err">{msg.text}</p>}</main>;

  return (
    <main>
      <div className="row"><h1>موجودی قابل‌سفارش</h1><span style={{ display: "flex", gap: ".75rem", alignItems: "center" }}><Link href="/reservations" className="muted">رزروهای من ←</Link><LogoutButton /></span></div>
      <p className="muted">{ctx.tenantName} — {ctx.agentLegalName}</p>

      {lots.length === 0 && <p className="muted">فعلاً کالای قابل‌سفارشی نیست.</p>}

      {lots.map((l) => {
        const bpp = l.boxes_per_pallet ?? 0;
        const pallets = bpp > 0 ? `${Math.floor(l.available / bpp)} پالت + ${l.available % bpp} کارتن` : null;
        // شفافیت رند (wireframe/spec ۱۰): عدد واقعی متراژ، فقط اگه sqcm_per_box داشته باشیم
        const meters = l.sqcm_per_box ? (l.available * l.sqcm_per_box / 10000).toFixed(2) : null;
        return (
          <div className="card" key={l.lot_id}>
            <div className="row">
              <strong>{l.name}</strong><span className="muted">{l.code}{l.grade ? ` — درجه ${l.grade}` : ""}</span>
            </div>
            <div className="muted">
              قابل‌سفارش: {l.available} کارتن{meters ? ` (معادل ${meters} متر)` : ""}{pallets ? ` — ${pallets}` : ""}
              {l.shade_code ? ` — شید ${l.shade_code}` : ""}{l.caliber_code ? ` کالیبر ${l.caliber_code}` : ""}
            </div>
            <div className="row" style={{ marginTop: ".5rem" }}>
              <input type="number" min={0} max={l.available} placeholder="تعداد کارتن"
                     value={cart[l.lot_id] ?? ""} style={{ maxWidth: 140 }}
                     onChange={(e) => setCart((c) => ({ ...c, [l.lot_id]: Math.max(0, Math.min(l.available, Number(e.target.value) || 0)) }))} />
            </div>
          </div>
        );
      })}

      {items.length > 0 && (
        <div className="card" style={{ position: "sticky", bottom: 0 }}>
          <strong>سبد رزرو ({items.length} قلم)</strong>
          {mixedShade && <div className="err">⚠️ شیدهای متفاوت در سبد — برای یک سطح پیوسته توصیه نمی‌شه.</div>}
          <div style={{ marginTop: ".75rem" }}>
            <button onClick={submit} disabled={pending}>
              {pending && <span className="spinner" />}
              {pending ? "در حال ثبت…" : "ثبت رزرو (همه یا هیچ)"}
            </button>
          </div>
        </div>
      )}
      {msg && <p className={msg.kind === "ok" ? "muted" : "err"} style={msg.kind === "ok" ? { color: "var(--ok)" } : undefined}>{msg.text}</p>}

      {outOfStock.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>ناموجودها</h2>
          <p className="muted">با «خبرم کن» به‌محض موجود شدن پیامک می‌گیری (یک‌بار).</p>
          {outOfStock.map((v) => {
            const on = subscribed.includes(v.variantId);
            return (
              <div className="card" key={v.variantId}>
                <div className="row">
                  <span>{v.name} <span className="muted">({v.code})</span></span>
                  <button className={on ? undefined : "ghost"} disabled={alertPending === v.variantId}
                    onClick={() => toggleAlert(v.variantId, !on)}>
                    {alertPending === v.variantId && <span className="spinner" />}
                    {on ? "🔔 خبرم بده (فعال)" : "خبرم کن"}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </main>
  );
}
