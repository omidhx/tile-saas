"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getJson, loadError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";

type AgentPerf = { agentId: string; agentName: string; requests: number; boxes: number; value: number; unpricedLines: number };
type TopProduct = { name: string; code: string; boxes: number };
type DeadStock = { name: string; code: string; onHand: number };
type Reports = { from: string; to: string; agents: AgentPerf[]; topProducts: TopProduct[]; deadStock: DeadStock[] };

const n = (v: number) => v.toLocaleString("fa-IR");
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function ReportsPage() {
  const { ctx, state } = useContexts("staff");
  const [rep, setRep] = useState<Reports | null>(null);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (tenantId: string, f: string, t: string) => {
    setLoading(true);
    // to را شاملِ خودِ روز می‌کنیم (کاربر «تا امروز» را یعنی «شاملِ امروز» می‌فهمد)
    const toExclusive = iso(new Date(new Date(t).getTime() + 86400000));
    const res = await getJson<Reports>(`/api/reports?tenantId=${tenantId}&from=${f}&to=${toExclusive}`);
    if (res.ok) { setRep(res.data); setLoadErr(""); }
    else setLoadErr(loadError(res.status));
    setLoading(false);
  }, []);

  useEffect(() => { if (ctx) load(ctx.tenantId, from, to); }, [ctx, from, to, load]);

  if (state === "none") return <main><p className="err" role="alert">این بخش فقط برای پشتیبان است.</p></main>;
  if (!ctx) return <main><p className="muted">در حال بارگذاری…</p></main>;

  const totalValue = rep?.agents.reduce((s, a) => s + a.value, 0) ?? 0;
  const totalBoxes = rep?.topProducts.reduce((s, p) => s + p.boxes, 0) ?? 0;

  return (
    <main>
      <div className="row"><h1>گزارش‌های مدیریتی</h1><Link href="/staff" className="muted">← پنل</Link></div>
      <p className="muted">{ctx.tenantName}</p>

      <div className="card">
        <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start", flexWrap: "wrap" }}>
          <label style={{ margin: 0 }}>از
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)}
              aria-label="از تاریخ" style={{ maxWidth: 170, marginInlineStart: ".4rem" }} />
          </label>
          <label style={{ margin: 0 }}>تا
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)}
              aria-label="تا تاریخ" style={{ maxWidth: 170, marginInlineStart: ".4rem" }} />
          </label>
          {loading && <span className="muted"><span className="spinner" aria-hidden="true" />در حال محاسبه…</span>}
        </div>
      </div>

      {loadErr && <div className="card" role="alert"><span className="err">⚠️ {loadErr}</span></div>}

      {rep && !loadErr && (
        <>
          {/* screen-reader-summary: خلاصه‌ی متنیِ نکته‌ی اصلی، نه فقط جدولِ خام */}
          <div className="card">
            <div className="metric num" style={{ fontSize: "1.1rem" }}>
              {n(totalValue)} ریال ارزشِ سفارش‌های تأییدشده · {n(totalBoxes)} کارتن بارگیری‌شده
            </div>
            <div className="muted">
              «ارزش» از قیمتِ ثبت‌شده در لحظه‌ی تأیید است و «بارگیری» از دفتر حرکات —
              این دو عمداً جدا هستند: یکی تعهد است، دیگری تحویلِ فیزیکی.
            </div>
          </div>

          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>عملکرد نمایندگان</h2>
          {rep.agents.length === 0
            ? <p className="muted">در این بازه سفارش تأییدشده‌ای ثبت نشده.</p>
            : rep.agents.map((a) => (
                <div className="card" key={a.agentId}>
                  <div className="row">
                    <strong>{a.agentName}</strong>
                    <span className="metric num">{n(a.value)} ریال</span>
                  </div>
                  <div className="muted num">{n(a.requests)} سفارش · {n(a.boxes)} کارتن</div>
                  {a.unpricedLines > 0 && (
                    <div className="err">
                      ⚠️ {n(a.unpricedLines)} خط بدون قیمتِ ثبت‌شده — ارزشِ بالا کمتر از واقعیت است.
                    </div>
                  )}
                </div>
              ))}

          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>پرفروش‌ها (بارگیری‌شده)</h2>
          {rep.topProducts.length === 0
            ? <p className="muted">در این بازه چیزی بارگیری نشده.</p>
            : rep.topProducts.map((p) => (
                <div className="card" key={p.code}>
                  <div className="row">
                    <span>{p.name} <span className="muted">({p.code})</span></span>
                    <span className="metric num">{n(p.boxes)} کارتن</span>
                  </div>
                </div>
              ))}

          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>راکدها (موجودیِ بدون فروش)</h2>
          {rep.deadStock.length === 0
            ? <p className="muted">همه‌ی کالاهای موجود در این بازه فروش داشته‌اند.</p>
            : <>
                <p className="muted">سرمایه‌ی خوابیده: موجودی دارند ولی در این بازه بارگیری نشده‌اند.</p>
                {rep.deadStock.map((d) => (
                  <div className="card" key={d.code}>
                    <div className="row">
                      <span>{d.name} <span className="muted">({d.code})</span></span>
                      <span className="metric num">{n(d.onHand)} کارتن</span>
                    </div>
                  </div>
                ))}
              </>}
        </>
      )}
    </main>
  );
}
