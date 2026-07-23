"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import NavMenu from "../../NavMenu";
import { getJson, postJson, actionError, loadError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";
import { formatJalaliDate, jalaliToDate, todayJalali, toJalali, type Jalali } from "@/lib/date";
import { JalaliDateInput } from "@/lib/JalaliDateInput";

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

export default function CustomersPage() {
  const { ctx, state } = useContexts("staff");
  const [customers, setCustomers] = useState<Customer[]>([]);
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
    const toExclusive = new Date(jalaliToDate(t).getTime() + 86400000).toISOString();
    const [c, r, ag] = await Promise.all([
      getJson<{ customers: Customer[] }>(`/api/customers?tenantId=${tenantId}`),
      getJson<{ rows: SalesRow[] }>(
        `/api/customers?tenantId=${tenantId}&report=1&from=${jalaliToDate(f).toISOString()}&to=${toExclusive}`),
      getJson<{ agents: Agent[] }>(`/api/agents?tenantId=${tenantId}`),
    ]);
    if (c.ok) setCustomers(c.data.customers);
    if (r.ok) setRows(r.data.rows);
    if (ag.ok) setAgents(ag.data.agents);
    const failed = [c, r, ag].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, []);

  useEffect(() => { if (ctx && !inverted) load(ctx.tenantId, from, to); }, [ctx, from, to, load, inverted]);

  async function add() {
    if (!ctx || !name.trim()) return;
    setPending("add"); setMsg("");
    const res = await postJson("/api/customers", { tenantId: ctx.tenantId, name, phone, agentAccountId: forAgent || null });
    if (!res.ok) setMsg(actionError(res.status));
    else { setName(""); setPhone(""); setMsg("ثبت شد."); await load(ctx.tenantId, from, to); }
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

  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const unlinked = rows.filter((r) => !r.linked).length;

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>مشتریان</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu /></nav>
      </div>

      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          مشتریِ <strong>نهاییِ نماینده</strong> است، نه مشتریِ کارخانه. نامِ روی حواله
          <strong> snapshot</strong> می‌ماند: اصلاحِ نامِ مشتری، حواله‌های صادرشده را بازنویسی نمی‌کند.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      {msg && (() => {
        const isErr = msg.includes("نشد") || msg.includes("نداری") || msg.includes("منقضی");
        return (
          <div className={`banner banner--${isErr ? "error" : "ok"}`} role="status">
            <Icon name={isErr ? "alert" : "check"} /><span>{msg}</span>
          </div>
        );
      })()}

      <h2>ثبت مشتری</h2>
      <div className="card">
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
      <div className="card">
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
          <div className="metric num" style={{ fontSize: "1.05rem" }}>{n(totalValue)} ریال در این بازه</div>
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
              {!r.linked && <span className="badge badge--warn" style={{ marginInlineStart: ".4rem" }}>وصل‌نشده</span>}
            </span>
            <span className="metric">{n(r.value)} ریال</span>
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
            <div style={{ marginTop: "var(--sp-3)" }}>
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
      {loaded && customers.length === 0 && <p className="empty">مشتری‌ای ثبت نشده.</p>}
      {customers.map((c) => (
        <div className="card" key={c.id}>
          <div className="row">
            <span>
              <strong>{c.name}</strong>
              {c.phone && <span className="subtle num"> · {c.phone}</span>}
              {!c.isActive && <span className="badge" style={{ marginInlineStart: ".4rem" }}>غیرفعال</span>}
            </span>
            <span className="row row--start">
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
            <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
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
    </main>
  );
}
