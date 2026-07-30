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
import { exportXlsx } from "@/lib/exportXlsx";
import LedgerSection from "./LedgerSection";
import AuditSection from "./AuditSection";

type AgentPerf = { agentId: string; agentName: string; requests: number; boxes: number; value: number; unpricedLines: number };
type TopProduct = { name: string; code: string; boxes: number };
type DeadStock = { name: string; code: string; onHand: number };
type DiscountByAgent = { agentId: string; agentName: string; discountedLines: number; discountAmount: number; grossAmount: number };
type DiscountByProduct = { name: string; code: string; discountedLines: number; discountAmount: number };
type Reports = {
  from: string; to: string; agents: AgentPerf[]; topProducts: TopProduct[]; deadStock: DeadStock[];
  discountsByAgent: DiscountByAgent[]; discountsByProduct: DiscountByProduct[];
};
type AgentOpt = { id: string; legalName: string };
type VariantOpt = { id: string; name: string; code: string };
type MonthlyBucket = { jy: number; jm: number; label: string };
type AgentMonthlyRow = { agentId: string; agentName: string; months: { boxes: number; value: number }[] };
type MonthlyAgentPerf = { buckets: MonthlyBucket[]; rows: AgentMonthlyRow[] };

const n = (v: number) => v.toLocaleString("fa-IR");
/** برای نامِ فایل — نه formatJalaliDate که با «/» می‌نویسد و در ویندوز نامِ فایلِ نامعتبر می‌سازد. */
const jstr = (j: Jalali) => `${j.jy}-${String(j.jm).padStart(2, "0")}-${String(j.jd).padStart(2, "0")}`;

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
  // فیلترِ اختیاریِ نماینده/کالا — همان گزارش، محدود به یکی از این دو (یا هردو)
  const [agentOpts, setAgentOpts] = useState<AgentOpt[]>([]);
  const [variantOpts, setVariantOpts] = useState<VariantOpt[]>([]);
  const [filterAgent, setFilterAgent] = useState("");
  const [filterVariant, setFilterVariant] = useState("");
  // عملکردِ نماینده ماه‌به‌ماه — بازه‌ی خودش دارد (N ماهِ اخیر)، مستقلِ از from/to بالا
  const [monthly, setMonthly] = useState<MonthlyAgentPerf | null>(null);
  const [monthlyCount, setMonthlyCount] = useState(6);
  const [monthlyErr, setMonthlyErr] = useState("");
  const [monthlyLoading, setMonthlyLoading] = useState(false);

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

  const load = useCallback(async (tenantId: string, f: Jalali, t: Jalali, agentId: string, variantId: string) => {
    setLoading(true);
    // مرزها به UTC می‌روند چون DB با UTC کار می‌کند؛ فقط نمایش شمسی است.
    // to را شاملِ خودِ روز می‌کنیم (کاربر «تا امروز» را یعنی «شاملِ امروز» می‌فهمد)
    const fromIso = jalaliToDate(f).toISOString();
    const toExclusive = new Date(jalaliToDate(t).getTime() + 86400000).toISOString();
    const qs = `tenantId=${tenantId}&from=${fromIso}&to=${toExclusive}`
      + (agentId ? `&agentAccountId=${agentId}` : "") + (variantId ? `&variantId=${variantId}` : "");
    const res = await getJson<Reports>(`/api/reports?${qs}`);
    if (res.ok) { setRep(res.data); setLoadErr(""); }
    else setLoadErr(loadError(res.status));
    setLoading(false);
  }, []);

  // فهرستِ نماینده‌ها/کالاها برای دو selectِ فیلتر — یک‌بار، مستقلِ از بازه/گزارش
  useEffect(() => {
    if (!ctx) return;
    (async () => {
      const [ag, cat] = await Promise.all([
        getJson<{ agents: AgentOpt[] }>(`/api/agents?tenantId=${ctx.tenantId}`),
        getJson<{ variants: VariantOpt[] }>(`/api/catalog?tenantId=${ctx.tenantId}`),
      ]);
      if (ag.ok) setAgentOpts(ag.data.agents);
      if (cat.ok) setVariantOpts(cat.data.variants);
    })();
  }, [ctx]);

  const loadMonthly = useCallback(async (tenantId: string, months: number) => {
    setMonthlyLoading(true);
    const res = await getJson<MonthlyAgentPerf>(`/api/reports?tenantId=${tenantId}&monthly=1&months=${months}`);
    if (res.ok) { setMonthly(res.data); setMonthlyErr(""); }
    else setMonthlyErr(loadError(res.status));
    setMonthlyLoading(false);
  }, []);

  useEffect(() => { if (ctx && tab === "reports") loadMonthly(ctx.tenantId, monthlyCount); }, [ctx, tab, monthlyCount, loadMonthly]);

  // با selectها دیگر min/max نداریم، پس بازه‌ی وارونه ممکن است — و بی‌راهنما
  // فقط یک گزارشِ خالی نشان می‌داد.
  const inverted = jalaliToDate(from) > jalaliToDate(to);

  useEffect(() => {
    if (ctx && tab === "reports" && !inverted) load(ctx.tenantId, from, to, filterAgent, filterVariant);
  }, [ctx, tab, from, to, filterAgent, filterVariant, load, inverted]);

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

  function exportReports() {
    if (!rep) return;
    exportXlsx(`گزارش-مدیریتی-${jstr(from)}-تا-${jstr(to)}.xlsx`, {
      "عملکرد نمایندگان": rep.agents.map((a) => ({
        "نمایندگی": a.agentName, "تعداد سفارش": a.requests, "کارتن": a.boxes,
        "ارزش (ریال)": a.value, "خطِ بی‌قیمت": a.unpricedLines,
      })),
      "پرفروش‌ها": rep.topProducts.map((p) => ({ "کالا": p.name, "کد": p.code, "کارتنِ بارگیری‌شده": p.boxes })),
      "راکدها": rep.deadStock.map((d) => ({ "کالا": d.name, "کد": d.code, "موجودی (کارتن)": d.onHand })),
      "تخفیف به‌تفکیکِ نماینده": rep.discountsByAgent.map((d) => ({
        "نمایندگی": d.agentName, "خطِ تخفیف‌دار": d.discountedLines,
        "مبلغِ تخفیف (ریال)": d.discountAmount, "مبلغِ ناخالص (ریال)": d.grossAmount,
      })),
      "تخفیف به‌تفکیکِ کالا": rep.discountsByProduct.map((d) => ({
        "کالا": d.name, "کد": d.code, "خطِ تخفیف‌دار": d.discountedLines, "مبلغِ تخفیف (ریال)": d.discountAmount,
      })),
      ...(monthly && monthly.rows.length > 0 ? {
        "ماه‌به‌ماه": monthly.rows.flatMap((r) => monthly.buckets.map((b, i) => ({
          "نمایندگی": r.agentName, "ماه": b.label, "کارتن": r.months[i].boxes, "ارزش (ریال)": r.months[i].value,
        }))),
      } : {}),
    });
  }

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>گزارش‌ها</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav className="no-print"><Link href="/staff">← پنل</Link><NavMenu ctx={ctx} /></nav>
      </div>

      <div className="no-print"><TabBar tabs={tabs} active={activeTab} onChange={go} /></div>

      {activeTab === "reports" && (
        <>
          <div className="card no-print">
            <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start", flexWrap: "wrap" }}>
              <JalaliDateInput label="از" value={from} onChange={setFrom} currentYear={to.jy} />
              <JalaliDateInput label="تا" value={to} onChange={setTo} currentYear={todayJalali().jy} />
              {loading && <span className="muted"><span className="spinner" aria-hidden="true" />در حال محاسبه…</span>}
            </div>
            {/* فیلترِ اختیاری: محدودکردنِ همین گزارش به یک نماینده و/یا یک کالا */}
            <div className="row row--start" style={{ gap: ".5rem", flexWrap: "wrap", marginTop: "var(--sp-3)" }}>
              <select aria-label="فیلترِ نماینده" value={filterAgent} onChange={(e) => setFilterAgent(e.target.value)} style={{ maxWidth: 220 }}>
                <option value="">همه‌ی نمایندگی‌ها</option>
                {agentOpts.map((a) => <option key={a.id} value={a.id}>{a.legalName}</option>)}
              </select>
              <select aria-label="فیلترِ کالا" value={filterVariant} onChange={(e) => setFilterVariant(e.target.value)} style={{ maxWidth: 260 }}>
                <option value="">همه‌ی کالاها</option>
                {variantOpts.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
              </select>
              {(filterAgent || filterVariant) && (
                <button className="ghost" onClick={() => { setFilterAgent(""); setFilterVariant(""); }}>پاک‌کردنِ فیلتر</button>
              )}
            </div>
          </div>

          {rep && !loadErr && !inverted && (
            <div className="row row--start no-print" style={{ gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
              <button onClick={exportReports}><Icon name="download" size={13} />خروجیِ اکسل</button>
              <button onClick={() => window.print()}><Icon name="printer" size={13} />خروجیِ PDF (چاپ)</button>
            </div>
          )}

          {/* ماه‌به‌ماه — بازه‌ی خودش دارد (N ماهِ اخیر شمسی)، مستقلِ از «از/تا»ی بالا؛
              برایِ دیدنِ روند (رشد/افت)، نه یک بازه‌ی تکی. */}
          <h2>عملکردِ نمایندگان ماه‌به‌ماه</h2>
          <div className="card no-print">
            <label htmlFor="monthly-count">تعدادِ ماه</label>
            <select id="monthly-count" value={monthlyCount} onChange={(e) => setMonthlyCount(Number(e.target.value))} style={{ maxWidth: 140 }}>
              <option value={3}>۳ ماهِ اخیر</option>
              <option value={6}>۶ ماهِ اخیر</option>
              <option value={12}>۱۲ ماهِ اخیر</option>
            </select>
            {monthlyLoading && <span className="muted"><span className="spinner" aria-hidden="true" /> در حال محاسبه…</span>}
          </div>
          {monthlyErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{monthlyErr}</span></div>}
          {monthly && !monthlyErr && monthly.rows.length === 0 && (
            <p className="empty">در این {n(monthlyCount)} ماه سفارشِ تأییدشده‌ای ثبت نشده.</p>
          )}
          {monthly && !monthlyErr && monthly.rows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="num" style={{ width: "100%", borderCollapse: "collapse", whiteSpace: "nowrap" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "start", padding: "var(--sp-2)", borderBottom: "2px solid var(--line-strong)" }}>نمایندگی</th>
                    {monthly.buckets.map((b) => (
                      <th key={`${b.jy}-${b.jm}`} style={{ textAlign: "start", padding: "var(--sp-2)", borderBottom: "2px solid var(--line-strong)" }}>{b.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthly.rows.map((r) => (
                    <tr key={r.agentId} style={{ borderBottom: "1px solid var(--line)" }}>
                      <td style={{ padding: "var(--sp-2)" }}>{r.agentName}</td>
                      {r.months.map((m, i) => (
                        <td key={i} style={{ padding: "var(--sp-2)" }}>
                          {m.boxes > 0
                            ? <>{n(m.boxes)} کارتن<div className="subtle">{n(m.value)} ریال</div></>
                            : <span className="subtle">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

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
              {filterAgent && <p className="subtle">موجودی مالِ نماینده‌ی خاصی نیست — فیلترِ نماینده اینجا اثر ندارد.</p>}
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

              <h2>تخفیف‌های اعمال‌شده</h2>
              <p className="muted">
                از پله‌ی تخفیفِ حجمیِ لحظه‌ی تأیید — مستقل از اینکه قیمتِ پایه از لیست بود یا استثنای نماینده.
              </p>
              <h3 className="subtle" style={{ marginBottom: "var(--sp-2)" }}>به‌تفکیکِ نماینده</h3>
              {rep.discountsByAgent.length === 0
                ? <p className="muted">در این بازه تخفیفی اعمال نشده.</p>
                : rep.discountsByAgent.map((d) => (
                    <div className="card" key={d.agentId}>
                      <div className="row">
                        <strong>{d.agentName}</strong>
                        <span className="metric num">{n(d.discountAmount)} ریال</span>
                      </div>
                      <div className="muted num">
                        {n(d.discountedLines)} خطِ تخفیف‌دار
                        {d.grossAmount > 0 && ` · ${((d.discountAmount / d.grossAmount) * 100).toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪ از مبلغِ ناخالص`}
                      </div>
                    </div>
                  ))}

              <h3 className="subtle" style={{ marginBottom: "var(--sp-2)" }}>به‌تفکیکِ کالا</h3>
              {rep.discountsByProduct.length === 0
                ? <p className="muted">در این بازه تخفیفی اعمال نشده.</p>
                : rep.discountsByProduct.map((d) => (
                    <div className="card" key={d.code}>
                      <div className="row">
                        <span>{d.name} <span className="muted">({d.code})</span></span>
                        <span className="metric num">{n(d.discountAmount)} ریال</span>
                      </div>
                      <div className="muted num">{n(d.discountedLines)} خطِ تخفیف‌دار</div>
                    </div>
                  ))}
            </>
          )}
        </>
      )}

      {activeTab === "ledger" && <LedgerSection ctx={ctx} />}
      {activeTab === "audit" && <AuditSection ctx={ctx} onLedger={() => go("ledger")} />}
    </main>
  );
}
