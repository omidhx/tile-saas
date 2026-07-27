"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import { hasPageAccess } from "@/lib/staffPages";
import NavMenu from "../../NavMenu";
import { TabBar, type Tab } from "../Tabs";
import { getJson, loadError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";
import { JalaliDateInput } from "@/lib/JalaliDateInput";
import { toJalali, jalaliToDate, todayJalali, type Jalali } from "@/lib/date";
import LedgerSection from "./LedgerSection";
import AuditSection from "./AuditSection";

type AgentPerf = { agentId: string; agentName: string; requests: number; boxes: number; value: number; unpricedLines: number };
type TopProduct = { name: string; code: string; boxes: number };
type DeadStock = { name: string; code: string; onHand: number };
type Reports = { from: string; to: string; agents: AgentPerf[]; topProducts: TopProduct[]; deadStock: DeadStock[] };

const n = (v: number) => v.toLocaleString("fa-IR");

const ALL_TABS: (Tab & { pageKey: string })[] = [
  { key: "reports", label: "گزارش‌های مدیریتی", pageKey: "reports" },
  { key: "ledger", label: "دفتر حرکات موجودی", pageKey: "ledger" },
  { key: "audit", label: "دفتر تغییرات", pageKey: "audit" },
];

export default function ReportsHubPage() {
  const { ctx, state } = useContexts("staff");
  const [tab, setTab] = useState("reports");
  const [rep, setRep] = useState<Reports | null>(null);
  const [from, setFrom] = useState<Jalali>(() => toJalali(new Date(Date.now() - 30 * 86400000)));
  const [to, setTo] = useState<Jalali>(todayJalali);
  const [loadErr, setLoadErr] = useState("");
  const [loading, setLoading] = useState(false);

  // آدرسِ ورودی (مثلاً از NavMenu: ?tab=ledger) تبِ اولیه را تعیین می‌کند —
  // فقط در کلاینت خوانده می‌شود تا با رندرِ اول (که همیشه «reports» است) ناسازگار نشود.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && ALL_TABS.some((x) => x.key === t)) setTab(t);
  }, []);
  function go(key: string) {
    setTab(key);
    history.replaceState(null, "", `?tab=${key}`);
  }

  const load = useCallback(async (tenantId: string, f: Jalali, t: Jalali) => {
    setLoading(true);
    // مرزها به UTC می‌روند چون DB با UTC کار می‌کند؛ فقط نمایش شمسی است.
    // to را شاملِ خودِ روز می‌کنیم (کاربر «تا امروز» را یعنی «شاملِ امروز» می‌فهمد)
    const fromIso = jalaliToDate(f).toISOString();
    const toExclusive = new Date(jalaliToDate(t).getTime() + 86400000).toISOString();
    const res = await getJson<Reports>(`/api/reports?tenantId=${tenantId}&from=${fromIso}&to=${toExclusive}`);
    if (res.ok) { setRep(res.data); setLoadErr(""); }
    else setLoadErr(loadError(res.status));
    setLoading(false);
  }, []);

  // با selectها دیگر min/max نداریم، پس بازه‌ی وارونه ممکن است — و بی‌راهنما
  // فقط یک گزارشِ خالی نشان می‌داد.
  const inverted = jalaliToDate(from) > jalaliToDate(to);

  useEffect(() => { if (ctx && tab === "reports" && !inverted) load(ctx.tenantId, from, to); }, [ctx, tab, from, to, load, inverted]);

  if (state === "none")
    return (
      <main>
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>این بخش فقط برای پشتیبان است.</span>
        </div>
      </main>
    );
  if (!ctx) return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;

  // v6: این سه صفحه‌ی جدا (گزارش‌ها/دفترِ حرکات/دفترِ تغییرات) ادغام شدند چون
  // هر سه فقط نمایشی‌اند و پشتیبان مدام بینشان سوییچ می‌کرد — حالا زیرِ یک مسیرِ
  // تب‌دار. هر تب دسترسیِ pageKeyِ خودش را جدا نگه می‌دارد (مثلِ قبل)، تا کسی که
  // فقط «گزارش‌ها» دارد نه «دفترِ تغییرات» را نبیند.
  const tabs = ctx.role === "admin" ? ALL_TABS : ALL_TABS.filter((t) => hasPageAccess(ctx.allowedPages, t.pageKey));
  if (tabs.length === 0)
    return <main><div className="banner banner--error" role="alert"><Icon name="alert" /><span>دسترسیِ این بخش برایت باز نیست — از مدیر بخواه اضافه‌اش کند.</span></div></main>;
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  const totalValue = rep?.agents.reduce((s, a) => s + a.value, 0) ?? 0;
  const totalBoxes = rep?.topProducts.reduce((s, p) => s + p.boxes, 0) ?? 0;

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>گزارش‌ها</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu ctx={ctx} /></nav>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={go} />

      {activeTab === "reports" && (
        <>
          <div className="card">
            <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start", flexWrap: "wrap" }}>
              <JalaliDateInput label="از" value={from} onChange={setFrom} currentYear={to.jy} />
              <JalaliDateInput label="تا" value={to} onChange={setTo} currentYear={todayJalali().jy} />
              {loading && <span className="muted"><span className="spinner" aria-hidden="true" />در حال محاسبه…</span>}
            </div>
          </div>

          {inverted && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>تاریخِ «از» بعد از «تا» است — بازه را اصلاح کنید.</span></div>}
          {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}

          {rep && !loadErr && !inverted && (
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

              <h2>عملکرد نمایندگان</h2>
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
                        <div className="err" style={{ marginTop: "var(--sp-2)" }}>
                          <Icon name="alert" />
                          {n(a.unpricedLines)} خط بدون قیمتِ ثبت‌شده — ارزشِ بالا کمتر از واقعیت است.
                        </div>
                      )}
                    </div>
                  ))}

              <h2>پرفروش‌ها (بارگیری‌شده)</h2>
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

              <h2>راکدها (موجودیِ بدون فروش)</h2>
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
        </>
      )}

      {activeTab === "ledger" && <LedgerSection ctx={ctx} />}
      {activeTab === "audit" && <AuditSection ctx={ctx} onLedger={() => go("ledger")} />}
    </main>
  );
}
