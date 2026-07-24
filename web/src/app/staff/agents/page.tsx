"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import NavMenu from "../../NavMenu";
import MessageBanner from "../../MessageBanner";
import { getJson, postJson, loadError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";
import DeleteButton from "../../DeleteButton";

type AgentUser = { userId: string; phone: string; email: string | null };
type Agent = {
  id: string; legalName: string; code: string; isActive: boolean;
  priceListId: string | null; priceListName: string | null;
  creditLimit: number | null; autoApproveLimit: number | null;
  users: AgentUser[];
};
type PriceList = { id: string; name: string };

const n = (v: number) => v.toLocaleString("fa-IR");
const FA: Record<string, string> = {
  seat_limit: "سقفِ تعدادِ نمایندگی‌های این اشتراک پر شده — برای افزایش با پشتیبانی تماس بگیرید.",
  code_taken: "این کد قبلاً برای نمایندگیِ دیگری استفاده شده.",
  email_taken: "این ایمیل قبلاً برای کاربرِ دیگری ثبت شده.",
  already_linked: "این کاربر از قبل به این نمایندگی وصل است.",
  has_history: "این نمایندگی سابقه دارد (رزرو/سفارش/حواله/مشتری) — حذف نمی‌شود. غیرفعالش کنید.",
};

export default function AgentsPage() {
  const { ctx, state } = useContexts("staff");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [tempPassword, setTempPassword] = useState<{ phone: string; password: string } | null>(null);

  // فرمِ ساخت
  const [legalName, setLegalName] = useState("");
  const [code, setCode] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [autoApproveLimit, setAutoApproveLimit] = useState("");
  const [firstPhone, setFirstPhone] = useState("");
  const [firstEmail, setFirstEmail] = useState("");

  // افزودنِ کاربرِ دیگر به یک نمایندگیِ موجود
  const [addFor, setAddFor] = useState<string | null>(null);
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");

  const load = useCallback(async (tenantId: string) => {
    const [a, p] = await Promise.all([
      getJson<{ agents: Agent[] }>(`/api/agents?tenantId=${tenantId}&detail=1`),
      getJson<{ lists: PriceList[] }>(`/api/prices?tenantId=${tenantId}`),
    ]);
    if (a.ok) { setAgents(a.data.agents); setLoadErr(""); } else setLoadErr(loadError(a.status));
    if (p.ok) setPriceLists(p.data.lists);
    setLoaded(true);
  }, []);

  useEffect(() => { if (ctx?.role === "admin") load(ctx.tenantId); }, [ctx, load]);

  function resetForm() {
    setLegalName(""); setCode(""); setPriceListId(""); setCreditLimit(""); setAutoApproveLimit("");
    setFirstPhone(""); setFirstEmail("");
  }

  async function create() {
    if (!ctx || !legalName.trim() || !code.trim() || !firstPhone.trim()) return;
    setPending("create"); setMsg(""); setErr(""); setTempPassword(null);
    const res = await postJson("/api/agents", {
      tenantId: ctx.tenantId, legalName: legalName.trim(), code: code.trim(),
      priceListId: priceListId || null,
      creditLimit: creditLimit.trim() ? Number(creditLimit) : null,
      autoApproveLimit: autoApproveLimit.trim() ? Number(autoApproveLimit) : null,
      firstUserPhone: firstPhone.trim(), firstUserEmail: firstEmail.trim() || undefined,
    });
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `ساختِ نمایندگی انجام نشد (خطای ${res.status}).`);
      return;
    }
    const data = res.data as { tempPassword: string | null };
    if (data.tempPassword) setTempPassword({ phone: firstPhone.trim(), password: data.tempPassword });
    setMsg("نمایندگی ساخته شد.");
    resetForm();
    await load(ctx.tenantId);
  }

  async function toggleActive(a: Agent) {
    if (!ctx) return;
    setPending(a.id); setMsg(""); setErr("");
    const res = await postJson("/api/agents", { tenantId: ctx.tenantId, agentAccountId: a.id, isActive: !a.isActive }, "PATCH");
    setPending(null);
    if (!res.ok) { setErr(`تغییر انجام نشد (خطای ${res.status}).`); return; }
    await load(ctx.tenantId);
  }

  async function remove(agentAccountId: string) {
    if (!ctx) return;
    setPending("del" + agentAccountId); setMsg(""); setErr("");
    const res = await postJson("/api/agents", { tenantId: ctx.tenantId, agentAccountId }, "DELETE");
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `حذف انجام نشد (خطای ${res.status}).`);
      return;
    }
    setMsg("نمایندگی حذف شد.");
    await load(ctx.tenantId);
  }

  async function addUser(agentAccountId: string) {
    if (!ctx || !addPhone.trim()) return;
    setPending("add" + agentAccountId); setMsg(""); setErr(""); setTempPassword(null);
    const res = await postJson("/api/agents", {
      tenantId: ctx.tenantId, agentAccountId, addUser: { phone: addPhone.trim(), email: addEmail.trim() || undefined },
    }, "PATCH");
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `افزودن انجام نشد (خطای ${res.status}).`);
      return;
    }
    const data = res.data as { tempPassword: string | null };
    if (data.tempPassword) setTempPassword({ phone: addPhone.trim(), password: data.tempPassword });
    setMsg("کاربر افزوده شد.");
    setAddFor(null); setAddPhone(""); setAddEmail("");
    await load(ctx.tenantId);
  }

  if (state === "none")
    return <main><div className="banner banner--error" role="alert"><Icon name="alert" /><span>این بخش فقط برای پشتیبان است.</span></div></main>;
  if (!ctx) return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;
  if (ctx.role !== "admin")
    return <main><div className="banner banner--error" role="alert"><Icon name="alert" /><span>این بخش فقط برای مدیر است.</span></div></main>;

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>نمایندگی‌ها</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu /></nav>
      </div>

      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          هر نمایندگی حداقل یک کاربرِ ورودی دارد. کاربرِ اولش با موبایل ساخته می‌شود؛
          اگر آن موبایل از قبل در سامانه باشد، همان حساب وصل می‌شود (نه ساختِ حسابِ دوم).
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      {err && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{err}</span></div>}
      <MessageBanner msg={msg} />

      {tempPassword && (
        <div className="banner banner--ok" role="status" style={{ flexDirection: "column", alignItems: "flex-start", gap: "var(--sp-2)" }}>
          <span><Icon name="check" /> رمزِ یک‌بارمصرفِ <span className="num">{tempPassword.phone}</span>:</span>
          <strong className="num" style={{ fontSize: "1.2rem", letterSpacing: ".05em" }}>{tempPassword.password}</strong>
          <span className="subtle">این رمز فقط همین یک‌بار نشان داده می‌شود — اگر پیامک/ایمیل نرسید، همین را بدهید.</span>
        </div>
      )}

      <h2>نمایندگیِ تازه</h2>
      <div className="card">
        <label htmlFor="ln">نامِ حقوقی</label>
        <input id="ln" value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="مثلاً: نمایندگی اصفهان" />

        <label htmlFor="cd">کد</label>
        <input id="cd" value={code} onChange={(e) => setCode(e.target.value)} placeholder="AG-ESF" />

        <label htmlFor="pl">لیستِ قیمت (اختیاری)</label>
        <select id="pl" value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
          <option value="">— بدونِ لیستِ اختصاصی —</option>
          {priceLists.map((pl) => <option key={pl.id} value={pl.id}>{pl.name}</option>)}
        </select>

        <label htmlFor="cl">سقفِ اعتبار (ریال، اختیاری)</label>
        <input id="cl" inputMode="numeric" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />

        <label htmlFor="aa">سقفِ تأییدِ خودکارِ اختصاصی (ریال، اختیاری — خالی = ارثِ کارخانه)</label>
        <input id="aa" inputMode="numeric" value={autoApproveLimit} onChange={(e) => setAutoApproveLimit(e.target.value)} />

        <label htmlFor="fp">موبایلِ کاربرِ اول</label>
        <input id="fp" value={firstPhone} onChange={(e) => setFirstPhone(e.target.value)} placeholder="۰۹۱۲۰۰۰۰۰۰۰" />

        <label htmlFor="fe">ایمیلِ کاربرِ اول (اختیاری)</label>
        <input id="fe" type="email" value={firstEmail} onChange={(e) => setFirstEmail(e.target.value)} placeholder="name@example.com" />

        <button className="primary" onClick={create} aria-busy={pending === "create"}
                disabled={pending === "create" || !legalName.trim() || !code.trim() || !firstPhone.trim()}
                style={{ width: "100%", marginTop: "var(--sp-4)" }}>
          {pending === "create" && <span className="spinner" aria-hidden="true" />}ساختِ نمایندگی
        </button>
      </div>

      <h2>نمایندگی‌های موجود</h2>
      {loaded && agents.length === 0 && <p className="empty">نمایندگی‌ای ثبت نشده.</p>}
      {agents.map((a) => (
        <div className="card" key={a.id}>
          <div className="row">
            <span>
              <strong>{a.legalName}</strong> <span className="subtle num">{a.code}</span>
              {!a.isActive && <span className="badge" style={{ marginInlineStart: ".4rem" }}>غیرفعال</span>}
            </span>
            <span className="row row--start">
              <button className="ghost" disabled={pending === a.id} aria-busy={pending === a.id} onClick={() => toggleActive(a)}>
                {pending === a.id && <span className="spinner" aria-hidden="true" />}
                {a.isActive ? "غیرفعال کن" : "فعال کن"}
              </button>
              <DeleteButton pending={pending === "del" + a.id} onConfirm={() => remove(a.id)} />
            </span>
          </div>
          <div className="muted">
            {a.priceListName ?? "بدونِ لیستِ اختصاصی"}
            {a.creditLimit != null && <> · سقفِ اعتبار: {n(a.creditLimit)} ریال</>}
            {a.autoApproveLimit != null && <> · تأییدِ خودکارِ اختصاصی: {n(a.autoApproveLimit)} ریال</>}
          </div>
          <div style={{ marginTop: "var(--sp-2)" }}>
            {a.users.map((u) => (
              <div key={u.userId} className="subtle num">
                {u.phone}{u.email ? ` · ${u.email}` : ""}
              </div>
            ))}
          </div>

          <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-2)", borderTop: "1px solid var(--line)" }}>
            {addFor === a.id ? (
              <div className="row row--start row--stack-mobile">
                <input value={addPhone} onChange={(e) => setAddPhone(e.target.value)} placeholder="موبایل" style={{ maxWidth: 180 }} />
                <input type="email" value={addEmail} onChange={(e) => setAddEmail(e.target.value)} placeholder="ایمیل (اختیاری)" style={{ maxWidth: 200 }} />
                <button className="primary" onClick={() => addUser(a.id)}
                        disabled={pending === "add" + a.id || !addPhone.trim()}>
                  {pending === "add" + a.id && <span className="spinner" aria-hidden="true" />}افزودن
                </button>
                <button className="ghost" onClick={() => { setAddFor(null); setAddPhone(""); setAddEmail(""); }}>انصراف</button>
              </div>
            ) : (
              <button className="ghost" onClick={() => { setAddFor(a.id); setAddPhone(""); setAddEmail(""); }}>
                + افزودنِ کاربرِ دیگر
              </button>
            )}
          </div>
        </div>
      ))}
    </main>
  );
}
