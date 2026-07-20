"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getJson, loadError } from "@/lib/api";
import { useContexts, type Ctx } from "@/lib/useContexts";
import ContextSwitcher from "../ContextSwitcher";
import LogoutButton from "../LogoutButton";

type Lot = {
  lot_id: string; name: string; code: string; grade: string | null;
  shade_code: string | null; caliber_code: string | null;
  available: number; boxes_per_pallet: number | null; sqcm_per_box: number | null;
  unitPrice: number | null;
};

type WaitlistEntry = { variantId: string; name: string; code: string; quantityBoxes: number; position: number };

// پول در دیتابیس عددِ صحیح است؛ اعشار/جداکننده فقط همین‌جا در لایه‌ی UI (قانون #۷)
const money = (v: number) => v.toLocaleString("fa-IR");

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
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const loadLots = useCallback(async (c: Ctx) => {
    const [lotsRes, alertsRes, queueRes] = await Promise.all([
      getJson<{ lots: Lot[] }>(`/api/lots?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`),
      getJson<{ subscribed: string[]; outOfStock: { variantId: string; name: string; code: string }[] }>(
        `/api/alerts?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`),
      getJson<{ entries: WaitlistEntry[] }>(
        `/api/waitlist?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`),
    ]);
    if (lotsRes.ok) setLots(lotsRes.data.lots);
    if (alertsRes.ok) { setSubscribed(alertsRes.data.subscribed); setOutOfStock(alertsRes.data.outOfStock); }
    if (queueRes.ok) setQueue(queueRes.data.entries);
    // «کالایی نیست» نباید وقتی نگرفتیم نشان داده شود
    const failed = [lotsRes, alertsRes, queueRes].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
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

  async function joinQueue(variantId: string) {
    if (!ctx) return;
    const quantityBoxes = Number(queueQty[variantId]);
    if (!Number.isInteger(quantityBoxes) || quantityBoxes <= 0) return;
    setQueuePending(variantId);
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId, variantId, quantityBoxes }),
      });
      setMsg(res.ok
        ? { kind: "ok", text: "در صف قرار گرفتی. به‌محض آزاد شدن موجودی، همان تعداد برایت رزرو می‌شود." }
        : { kind: "err", text: "ثبت نوبت انجام نشد." });
      if (res.ok) await loadLots(ctx);
    } finally { setQueuePending(null); }
  }

  async function leaveQueue(variantId: string) {
    if (!ctx) return;
    setQueuePending(variantId);
    try {
      await fetch("/api/waitlist", {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId, variantId }),
      });
      await loadLots(ctx);
    } finally { setQueuePending(null); }
  }

  // با تغییر نمایندگی، داده‌ی همان نمایندگی دوباره بارگذاری می‌شود
  useEffect(() => { if (ctx) { setCart({}); loadLots(ctx); } }, [ctx, loadLots]);

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
    return <main><p className="err" role="alert">این کاربر به نمایندگی‌ای وصل نیست. اگر پشتیبان هستی، به پنل پشتیبان برو.</p></main>;
  if (!ctx) return <main><p className="muted">در حال بارگذاری…</p></main>;

  return (
    <main>
      <div className="row"><h1>موجودی قابل‌سفارش</h1><span style={{ display: "flex", gap: ".75rem", alignItems: "center" }}><Link href="/reservations" className="muted">رزروهای من ←</Link><LogoutButton /></span></div>
      <div className="row" style={{ justifyContent: "flex-start", gap: ".75rem", flexWrap: "wrap" }}>
        <p className="muted" style={{ margin: 0 }}>{ctx.tenantName} — {ctx.agentLegalName}</p>
        <ContextSwitcher contexts={contexts} ctx={ctx} onSelect={select} mode="agent" />
      </div>

      {loadErr && <div className="card" role="alert"><span className="err">⚠️ {loadErr} فهرست ناقص است.</span></div>}
      {loaded && !loadErr && lots.length === 0 && <p className="muted">فعلاً کالای قابل‌سفارشی نیست.</p>}

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
            <div className="muted">
              {l.unitPrice !== null ? `قیمت من: ${money(l.unitPrice)} ریال / کارتن` : "قیمتی برای شما ثبت نشده"}
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
              {pending && <span className="spinner" aria-hidden="true" />}
              {pending ? "در حال ثبت…" : "ثبت رزرو (همه یا هیچ)"}
            </button>
          </div>
        </div>
      )}
      {msg && <p className={msg.kind === "ok" ? "muted" : "err"} style={msg.kind === "ok" ? { color: "var(--ok)" } : undefined}>{msg.text}</p>}

      {outOfStock.length > 0 && (
        <>
          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>ناموجودها</h2>
          <p className="muted">
            <strong>خبرم کن</strong>: به‌محض موجود شدن یک پیامک می‌گیری (بدون رزرو — هرکس زودتر
            سفارش دهد می‌برد).{" "}
            <strong>نوبت بگیر</strong>: به‌ترتیبِ نوبت، به‌محض آزاد شدن موجودی همان تعداد
            <em> برایت رزرو می‌شود</em> و خبرش را می‌گیری.
          </p>
          {outOfStock.map((v) => {
            const on = subscribed.includes(v.variantId);
            const q = queue.find((w) => w.variantId === v.variantId);
            return (
              <div className="card" key={v.variantId}>
                <div className="row">
                  <span>{v.name} <span className="muted">({v.code})</span></span>
                  <button className={on ? undefined : "ghost"} disabled={alertPending === v.variantId}
                    onClick={() => toggleAlert(v.variantId, !on)}>
                    {alertPending === v.variantId && <span className="spinner" aria-hidden="true" />}
                    {on ? "🔔 خبرم بده (فعال)" : "خبرم کن"}
                  </button>
                </div>
                <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start", marginTop: ".5rem" }}>
                  {q ? (
                    <>
                      <span className="num">در نوبت: {money(q.quantityBoxes)} کارتن · نفر {money(q.position)}</span>
                      <button className="ghost" disabled={queuePending === v.variantId}
                        onClick={() => leaveQueue(v.variantId)}>
                        {queuePending === v.variantId && <span className="spinner" aria-hidden="true" />}
                        انصراف از نوبت
                      </button>
                    </>
                  ) : (
                    <>
                      <input type="number" min={1} inputMode="numeric" placeholder="تعداد کارتن"
                        aria-label={`تعداد برای نوبت ${v.name}`} style={{ maxWidth: 150 }}
                        value={queueQty[v.variantId] ?? ""}
                        onChange={(e) => setQueueQty({ ...queueQty, [v.variantId]: e.target.value })} />
                      <button disabled={queuePending === v.variantId || !(Number(queueQty[v.variantId]) > 0)}
                        onClick={() => joinQueue(v.variantId)}>
                        {queuePending === v.variantId && <span className="spinner" aria-hidden="true" />}
                        نوبت بگیر
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
    </main>
  );
}
