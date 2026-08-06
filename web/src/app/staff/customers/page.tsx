"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import { hasPageAccess } from "@/lib/staffPages";
import MessageBanner from "../../MessageBanner";
import NavMenu from "../../NavMenu";
import { getJson, postJson, actionError, loadError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";
import { formatJalaliDate, jalaliToDate, todayJalali, toJalali, type Jalali } from "@/lib/date";
import { JalaliDateInput } from "@/lib/JalaliDateInput";
import { exportXlsx } from "@/lib/exportXlsx";
import { formatMoney, toDisplayAmount, currencyLabel } from "@/lib/money";

type Customer = {
  id: string; name: string; phone: string | null; note: string | null;
  agentAccountId: string | null; agentName: string | null; isActive: boolean;
};
type SalesRow = {
  customerId: string | null; name: string; dispatches: number;
  boxes: number; value: number; unknownValueDispatches: number; linked: boolean;
};
type HistoryRow = {
  dispatchId: string; dispatchCode: string; status: string; createdAt: string;
  agentName: string; warehouseName: string | null; boxes: number;
};
type Agent = { id: string; legalName: string };

const n = (v: number) => v.toLocaleString("fa-IR");
const FA: Record<string, string> = {
  registered: "ثبت‌شده", ready_for_loading: "آماده بارگیری", loaded: "بارگیری‌شده",
  delivered: "تحویل‌شده", cancelled: "لغوشده",
};
/** برای نامِ فایل — نه formatJalaliDate که با «/» می‌نویسد و در ویندوز نامِ فایلِ نامعتبر می‌سازد. */
const jstr = (j: Jalali) => `${j.jy}-${String(j.jm).padStart(2, "0")}-${String(j.jd).padStart(2, "0")}`;

export default function CustomersPage() {
  const { ctx, state } = useContexts("staff");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [custQ, setCustQ] = useState("");
  const [custHasMore, setCustHasMore] = useState(false);
  const [custMoreBusy, setCustMoreBusy] = useState(false);
  // نسخه‌شمار: پاسخِ یک جستجوی قدیمی نباید بعدِ جستجوی جدید لیست را بازنویسی کند
  // (همان الگوی race-guard در staff/page.tsx برای dispatches/backorders).
  const custGen = useRef(0);
  const custDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [history, setHistory] = useState<Record<string, HistoryRow[]>>({});
  const [from, setFrom] = useState<Jalali>(() => toJalali(new Date(Date.now() - 90 * 86400000)));
  const [to, setTo] = useState<Jalali>(todayJalali);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [forAgent, setForAgent] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: "", phone: "", note: "" });

  const inverted = jalaliToDate(from) > jalaliToDate(to);

  const load = useCallback(async (tenantId: string, f: Jalali, t: Jalali) => {
    const myGen = ++custGen.current;
    const toExclusive = new Date(jalaliToDate(t).getTime() + 86400000).toISOString();
    const [c, r, ag] = await Promise.all([
      getJson<{ customers: Customer[]; hasMore: boolean }>(`/api/customers?tenantId=${tenantId}&offset=0`),
      getJson<{ rows: SalesRow[] }>(
        `/api/customers?tenantId=${tenantId}&report=1&from=${jalaliToDate(f).toISOString()}&to=${toExclusive}`),
      getJson<{ agents: Agent[] }>(`/api/agents?tenantId=${tenantId}`),
    ]);
    if (myGen !== custGen.current) return;
    if (c.ok) { setCustomers(c.data.customers); setCustHasMore(c.data.hasMore); setCustQ(""); }
    if (r.ok) setRows(r.data.rows);
    if (ag.ok) setAgents(ag.data.agents);
    const failed = [c, r, ag].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, []);

  function searchCustomers(tenantId: string, v: string) {
    setCustQ(v);
    if (custDebounce.current) clearTimeout(custDebounce.current);
    const myGen = ++custGen.current;
    custDebounce.current = setTimeout(async () => {
      const res = await getJson<{ customers: Customer[]; hasMore: boolean }>(
        `/api/customers?tenantId=${tenantId}&offset=0${v ? `&q=${encodeURIComponent(v)}` : ""}`);
      if (myGen !== custGen.current) return;
      if (res.ok) { setCustomers(res.data.customers); setCustHasMore(res.data.hasMore); }
    }, 300);
  }

  async function loadMoreCustomers(tenantId: string) {
    const myGen = ++custGen.current;
    setCustMoreBusy(true);
    try {
      const res = await getJson<{ customers: Customer[]; hasMore: boolean }>(
        `/api/customers?tenantId=${tenantId}&offset=${customers.length}${custQ ? `&q=${encodeURIComponent(custQ)}` : ""}`);
      if (myGen !== custGen.current) return;
      if (res.ok) { setCustomers((prev) => [...prev, ...res.data.customers]); setCustHasMore(res.data.hasMore); }
    } finally { if (myGen === custGen.current) setCustMoreBusy(false); }
  }

  useEffect(() => { if (ctx && !inverted) load(ctx.tenantId, from, to); }, [ctx, from, to, load, inverted]);

  async function add() {
    if (!ctx || !name.trim()) return;
    setPending("add"); setMsg("");
    const res = await postJson("/api/customers", { tenantId: ctx.tenantId, name, phone, agentAccountId: forAgent || null });
    if (!res.ok) setMsg(actionError(res.status));
    else {
      // اگر «نمایندگی» پاک نشود، مشتریِ بعدی که نامرتبط با همین نمایندگی است
      // بی‌آنکه کاربر متوجه شود به همان نمایندگیِ قبلی وصل می‌شود.
      setName(""); setPhone(""); setForAgent(""); setMsg("ثبت شد.");
      await load(ctx.tenantId, from, to);
    }
    setPending(null);
  }

  async function toggleActive(c: Customer) {
    if (!ctx) return;
    setPending(c.id); setMsg("");
    const res = await postJson("/api/customers", { tenantId: ctx.tenantId, id: c.id, isActive: !c.isActive }, "PATCH");
    if (!res.ok) setMsg(actionError(res.status));
    else await load(ctx.tenantId, from, to);
    setPending(null);
  }

  function startEdit(c: Customer) {
    setEditFor(c.id);
    setEditForm({ name: c.name, phone: c.phone ?? "", note: c.note ?? "" });
    setMsg("");
  }

  async function saveEdit(c: Customer) {
    if (!ctx || !editForm.name.trim()) return;
    setPending("edit" + c.id); setMsg("");
    const res = await postJson("/api/customers",
      { tenantId: ctx.tenantId, id: c.id, ...editForm }, "PATCH");
    if (!res.ok) setMsg(actionError(res.status));
    else { setEditFor(null); setMsg("مشتری ویرایش شد."); await load(ctx.tenantId, from, to); }
    setPending(null);
  }

  async function showHistory(customerId: string) {
    if (!ctx || history[customerId]) { // بستنِ دوباره
      setHistory((h) => { const { [customerId]: _drop, ...rest } = h; return rest; });
      return;
    }
    setPending("h" + customerId);
    try {
      const r = await getJson<{ history: HistoryRow[] }>(
        `/api/customers?tenantId=${ctx.tenantId}&customerId=${customerId}`);
      if (r.ok) setHistory((h) => ({ ...h, [customerId]: r.data.history }));
    } finally { setPending(null); }
  }

  if (state === "none")
    return (
      <main>
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>این بخش فقط برای پشتیبان است.</span>
        </div>
      </main>
    );
  if (!ctx) return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;
  if (ctx.role === "staff" && !hasPageAccess(ctx.allowedPages, "customers"))
    return <main><div className="banner banner--error" role="alert"><Icon name="alert" /><span>دسترسیِ این بخش برایت باز نیست — از مدیر بخواه اضافه‌اش کند.</span></div></main>;

  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const unlinked = rows.filter((r) => !r.linked).length;

  // «همه‌ی مشتریان» روی صفحه صفحه‌بندی‌شده است — خروجیِ اکسل باید کلِ فهرست باشد،
  // نه فقط صفحه‌ی بارگذاری‌شده (همان الگوی exportAll در LedgerSection).
  async function exportCustomers() {
    if (!ctx) return;
    setPending("export"); setMsg("");
    try {
      const res = await getJson<{ customers: Customer[] }>(
        `/api/customers?tenantId=${ctx.tenantId}&offset=0&limit=20000${custQ ? `&q=${encodeURIComponent(custQ)}` : ""}`);
      if (!res.ok) { setMsg(actionError(res.status)); return; }
      exportXlsx(`مشتریان-${jstr(from)}-تا-${jstr(to)}.xlsx`, {
        "پرخریدترین": rows.map((r) => ({
          "مشتری": r.name, "وصل به رکورد": r.linked ? "بله" : "خیر",
          "تعداد حواله": r.dispatches, "کارتن": r.boxes,
          [`ارزش (${currencyLabel(ctx.currencyUnit)})`]: toDisplayAmount(r.value, ctx.currencyUnit),
          "حواله‌ی بی‌ارزشِ معلوم": r.unknownValueDispatches,
        })),
        "همه‌ی مشتریان": res.data.customers.map((c) => ({
          "نام": c.name, "شماره": c.phone ?? "", "نمایندگی": c.agentName ?? "مستقیمِ کارخانه",
          "یادداشت": c.note ?? "", "وضعیت": c.isActive ? "فعال" : "غیرفعال",
        })),
      });
    } finally { setPending(null); }
  }

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>مشتریان</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav className="no-print"><Link href="/staff">← پنل</Link><NavMenu ctx={ctx} /></nav>
      </div>

      <div className="row row--start no-print" style={{ gap: "var(--sp-2)" }}>
        <button onClick={exportCustomers} aria-busy={pending === "export"} disabled={pending === "export"}>
          {pending === "export" && <span className="spinner" aria-hidden="true" />}<Icon name="download" size={13} />خروجیِ اکسل
        </button>
        <button onClick={() => window.print()}><Icon name="printer" size={13} />خروجیِ PDF (چاپ)</button>
      </div>

      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          مشتریِ <strong>نهاییِ نماینده</strong> است، نه مشتریِ کارخانه. نامِ روی حواله
          <strong> snapshot</strong> می‌ماند: اصلاحِ نامِ مشتری، حواله‌های صادرشده را بازنویسی نمی‌کند.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      <MessageBanner msg={msg} />

      <h2 className="no-print">ثبت مشتری</h2>
      <div className="card no-print">
        <label htmlFor="nm">نام</label>
        <input id="nm" value={name} onChange={(e) => setName(e.target.value)} placeholder="نام مشتری نهایی" />
        <label htmlFor="ph">شماره تماس (اختیاری)</label>
        <input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" />
        <label htmlFor="ag">نمایندگی</label>
        <select id="ag" value={forAgent} onChange={(e) => setForAgent(e.target.value)}>
          <option value="">— مشتری مستقیم کارخانه —</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.legalName}</option>)}
        </select>
        <button className="primary" onClick={add} aria-busy={pending === "add"}
                disabled={pending === "add" || !name.trim()}
                style={{ width: "100%", marginTop: "var(--sp-4)" }}>
          {pending === "add" && <span className="spinner" aria-hidden="true" />}افزودن
        </button>
      </div>

      <h2>پرخریدترین مشتریان</h2>
      <div className="card no-print">
        <div className="row row--start" style={{ flexWrap: "wrap" }}>
          <JalaliDateInput label="از" value={from} onChange={setFrom} currentYear={to.jy} />
          <JalaliDateInput label="تا" value={to} onChange={setTo} currentYear={todayJalali().jy} />
        </div>
      </div>

      {inverted && (
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>تاریخِ «از» بعد از «تا» است — بازه را اصلاح کنید.</span>
        </div>
      )}

      {!inverted && rows.length > 0 && (
        <div className="card">
          <div className="metric num" style={{ fontSize: "1.05rem" }}>{formatMoney(totalValue, ctx.currencyUnit)} در این بازه</div>
          {/* حواله‌های قدیمیِ متنِ آزاد حذف نشده‌اند — ولی باید معلوم باشد که هستند */}
          {unlinked > 0 && (
            <div className="muted">
              {n(unlinked)} ردیف به مشتریِ ثبت‌شده وصل نیست (حواله‌های قدیمی با نامِ متنِ آزاد).
            </div>
          )}
        </div>
      )}

      {loaded && !loadErr && !inverted && rows.length === 0 && (
        <p className="empty">در این بازه حواله‌ای ثبت نشده.</p>
      )}

      {!inverted && rows.map((r) => (
        <div className="card" key={r.customerId ?? r.name}>
          <div className="row">
            <span>
              <strong>{r.name}</strong>
              {!r.linked && <span className="badge badge--warn" style={{ marginInlineStart: "var(--sp-2)" }}>وصل‌نشده</span>}
            </span>
            <span className="metric">{formatMoney(r.value, ctx.currencyUnit)}</span>
          </div>
          <div className="muted num">{n(r.dispatches)} حواله · {n(r.boxes)} کارتن بارگیری‌شده</div>
          {/* «نامعلوم» ≠ «صفر» — همان قاعده‌ی گزارشِ خط‌های بی‌قیمت */}
          {r.unknownValueDispatches > 0 && (
            <div className="err">
              <Icon name="alert" />
              {n(r.unknownValueDispatches)} حواله ارزشِ معلوم ندارد (backorder یا بی‌قیمت) — رقمِ بالا کمتر از واقعیت است.
            </div>
          )}
          {r.customerId && (
            <div className="no-print" style={{ marginTop: "var(--sp-3)" }}>
              <button className="ghost" onClick={() => showHistory(r.customerId!)}
                      aria-busy={pending === "h" + r.customerId}>
                {history[r.customerId] ? "بستن تاریخچه" : "تاریخچه"}
              </button>
            </div>
          )}
          {r.customerId && history[r.customerId] && (
            <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
              {history[r.customerId].length === 0
                ? <span className="muted">حواله‌ای ثبت نشده.</span>
                : history[r.customerId].map((h) => (
                    <div className="row" key={h.dispatchId} style={{ marginBottom: "var(--sp-1)" }}>
                      <span className="num">{h.dispatchCode}</span>
                      <span className="muted">
                        {formatJalaliDate(h.createdAt)} · {FA[h.status] ?? h.status}
                        {h.warehouseName ? ` · ${h.warehouseName}` : ""} · {n(h.boxes)} کارتن
                      </span>
                    </div>
                  ))}
            </div>
          )}
        </div>
      ))}

      <h2>همه‌ی مشتریان</h2>
      <input type="search" aria-label="جستجوی مشتریان" placeholder="جستجو: نام، شماره، نمایندگی…"
        value={custQ} onChange={(e) => searchCustomers(ctx.tenantId, e.target.value)}
        style={{ marginBottom: "var(--sp-3)" }} />
      {loaded && customers.length === 0 && (
        <p className="empty">{custQ ? "چیزی پیدا نشد." : "مشتری‌ای ثبت نشده."}</p>
      )}
      {customers.map((c) => (
        <div className="card" key={c.id}>
          <div className="row">
            <span>
              <strong>{c.name}</strong>
              {c.phone && <span className="subtle num"> · {c.phone}</span>}
              {!c.isActive && <span className="badge" style={{ marginInlineStart: "var(--sp-2)" }}>غیرفعال</span>}
            </span>
            <span className="row row--start no-print">
              <button className="ghost" disabled={pending === "edit" + c.id}
                      onClick={() => (editFor === c.id ? setEditFor(null) : startEdit(c))}>
                {editFor === c.id ? "بستن ویرایش" : "ویرایش"}
              </button>
              <button className="ghost" onClick={() => toggleActive(c)}
                      aria-busy={pending === c.id} disabled={pending === c.id}>
                {c.isActive ? "غیرفعال کن" : "فعال کن"}
              </button>
            </span>
          </div>
          <div className="subtle">{c.agentName ?? "مشتری مستقیم کارخانه"}</div>

          {editFor === c.id && (
            <div className="no-print" style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
              <label htmlFor={`en-${c.id}`}>نام</label>
              <input id={`en-${c.id}`} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              <label htmlFor={`ep-${c.id}`}>شماره تماس</label>
              <input id={`ep-${c.id}`} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} inputMode="numeric" />
              <label htmlFor={`eo-${c.id}`}>یادداشت</label>
              <input id={`eo-${c.id}`} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
              <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
                <button className="primary" disabled={pending === "edit" + c.id || !editForm.name.trim()}
                        onClick={() => saveEdit(c)}>
                  {pending === "edit" + c.id && <span className="spinner" aria-hidden="true" />}ذخیره
                </button>
                <button className="ghost" onClick={() => setEditFor(null)}>انصراف</button>
              </div>
            </div>
          )}
        </div>
      ))}
      {custHasMore && (
        <button className="no-print" onClick={() => loadMoreCustomers(ctx.tenantId)}
                aria-busy={custMoreBusy} disabled={custMoreBusy} style={{ width: "100%" }}>
          {custMoreBusy && <span className="spinner" aria-hidden="true" />}بیشتر
        </button>
      )}
    </main>
  );
}
