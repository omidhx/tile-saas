"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../../Icon";
import MessageBanner from "../../MessageBanner";
import { getJson, postJson, loadError, actionError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";
import { formatMoney } from "@/lib/money";
import DeleteButton from "../../DeleteButton";
import { JalaliDateInput } from "@/lib/JalaliDateInput";
import { toJalali, todayJalali, formatJalaliDate, jalaliToIsoDate, type Jalali } from "@/lib/date";

type AgentUser = { userId: string; phone: string; email: string | null };
type Agent = {
  id: string; legalName: string; code: string; isActive: boolean;
  priceListId: string | null; priceListName: string | null;
  creditLimit: number | null; autoApproveLimit: number | null;
  assignedStaffUserId: string | null; assignedStaffName: string | null; assignedStaffPhone: string | null;
  users: AgentUser[];
};
type PriceList = { id: string; name: string };
type StaffOption = { userId: string; fullName: string | null; phone: string };
const staffLabel = (s: StaffOption) => s.fullName ? `${s.fullName} (${s.phone})` : s.phone;

type Variant = { id: string; name: string; code: string; sku: string };
type Override = {
  id: string; variantId: string; price: string; validFrom: string | null; validTo: string | null;
  productName: string; productCode: string;
};
const isoDate = jalaliToIsoDate;
const OVERRIDE_ERR_FA: Record<string, string> = {
  invalid: "قیمت/بازه نامعتبر است.",
  overlap: "برای همین نماینده و کالا، در این بازه یک استثنای دیگر از قبل هست.",
  not_found: "این استثنا دیگر وجود ندارد — فهرست به‌روز شد.",
};

const FA: Record<string, string> = {
  seat_limit: "سقفِ تعدادِ نمایندگی‌های این اشتراک پر شده — برای افزایش با پشتیبانی تماس بگیرید.",
  code_taken: "این کد قبلاً برای نمایندگیِ دیگری استفاده شده.",
  email_taken: "این ایمیل قبلاً برای کاربرِ دیگری ثبت شده.",
  already_linked: "این کاربر از قبل به این نمایندگی وصل است.",
  has_history: "این نمایندگی سابقه دارد (رزرو/سفارش/حواله/مشتری) — حذف نمی‌شود. غیرفعالش کنید.",
  invalid_staff: "این کاربر عضوِ فعالِ تیمِ پشتیبان/مدیر نیست.",
};

export default function AgentsSection({ ctx }: { ctx: Ctx }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [staffOptions, setStaffOptions] = useState<StaffOption[]>([]);
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
  const [assignedStaffUserId, setAssignedStaffUserId] = useState("");

  // افزودنِ کاربرِ دیگر به یک نمایندگیِ موجود
  const [addFor, setAddFor] = useState<string | null>(null);
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");

  // ویرایشِ درجای پشتیبانِ ثابت
  const [editStaffFor, setEditStaffFor] = useState<string | null>(null);
  const [editStaffId, setEditStaffId] = useState("");

  // استثنای قیمتِ نمایندگی‌محور (agent_price_override) — رویِ کارتِ همان نماینده
  const [variants, setVariants] = useState<Variant[]>([]);
  const [overrideFor, setOverrideFor] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Override[]>>({});
  const [ovVariantId, setOvVariantId] = useState("");
  const [ovPrice, setOvPrice] = useState("");
  const [ovHasFrom, setOvHasFrom] = useState(false);
  const [ovFrom, setOvFrom] = useState<Jalali>(todayJalali);
  const [ovHasTo, setOvHasTo] = useState(false);
  const [ovTo, setOvTo] = useState<Jalali>(todayJalali);
  const [ovErr, setOvErr] = useState("");
  const [ovEditId, setOvEditId] = useState<string | null>(null);
  const [ovEditPrice, setOvEditPrice] = useState("");
  const [ovEditHasFrom, setOvEditHasFrom] = useState(false);
  const [ovEditFrom, setOvEditFrom] = useState<Jalali>(todayJalali);
  const [ovEditHasTo, setOvEditHasTo] = useState(false);
  const [ovEditTo, setOvEditTo] = useState<Jalali>(todayJalali);

  const load = useCallback(async (tenantId: string) => {
    const [a, p, cat] = await Promise.all([
      getJson<{ agents: Agent[]; staffOptions: StaffOption[] }>(`/api/agents?tenantId=${tenantId}&detail=1`),
      getJson<{ lists: PriceList[] }>(`/api/prices?tenantId=${tenantId}`),
      getJson<{ variants: Variant[] }>(`/api/catalog?tenantId=${tenantId}`),
    ]);
    if (a.ok) { setAgents(a.data.agents); setStaffOptions(a.data.staffOptions); setLoadErr(""); } else setLoadErr(loadError(a.status));
    if (p.ok) setPriceLists(p.data.lists);
    if (cat.ok) setVariants(cat.data.variants);
    setLoaded(true);
  }, []);

  useEffect(() => { load(ctx.tenantId); }, [ctx.tenantId, load]);

  function resetForm() {
    setLegalName(""); setCode(""); setPriceListId(""); setCreditLimit(""); setAutoApproveLimit("");
    setFirstPhone(""); setFirstEmail(""); setAssignedStaffUserId("");
  }

  async function create() {
    if (!legalName.trim() || !code.trim() || !firstPhone.trim()) return;
    setPending("create"); setMsg(""); setErr(""); setTempPassword(null);
    const res = await postJson("/api/agents", {
      tenantId: ctx.tenantId, legalName: legalName.trim(), code: code.trim(),
      priceListId: priceListId || null,
      creditLimit: creditLimit.trim() ? Number(creditLimit) : null,
      autoApproveLimit: autoApproveLimit.trim() ? Number(autoApproveLimit) : null,
      assignedStaffUserId: assignedStaffUserId || null,
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

  function startEditStaff(a: Agent) { setEditStaffFor(a.id); setEditStaffId(a.assignedStaffUserId ?? ""); setMsg(""); setErr(""); }
  async function saveStaff(agentAccountId: string) {
    setPending("staff" + agentAccountId); setMsg(""); setErr("");
    const res = await postJson("/api/agents",
      { tenantId: ctx.tenantId, agentAccountId, assignedStaffUserId: editStaffId || null }, "PATCH");
    setPending(null);
    if (!res.ok) { setErr((res.error && FA[res.error]) || `تغییر انجام نشد (خطای ${res.status}).`); return; }
    setEditStaffFor(null);
    await load(ctx.tenantId);
  }

  async function toggleActive(a: Agent) {
    setPending(a.id); setMsg(""); setErr("");
    const res = await postJson("/api/agents", { tenantId: ctx.tenantId, agentAccountId: a.id, isActive: !a.isActive }, "PATCH");
    setPending(null);
    if (!res.ok) { setErr(`تغییر انجام نشد (خطای ${res.status}).`); return; }
    await load(ctx.tenantId);
  }

  async function remove(agentAccountId: string) {
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
    if (!addPhone.trim()) return;
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

  function resetOvForm() {
    setOvVariantId(""); setOvPrice(""); setOvHasFrom(false); setOvFrom(todayJalali()); setOvHasTo(false); setOvTo(todayJalali());
  }

  async function toggleOverridePanel(agentId: string) {
    if (overrideFor === agentId) { setOverrideFor(null); return; }
    setOverrideFor(agentId); setOvErr(""); resetOvForm(); setOvEditId(null);
    if (!overrides[agentId]) {
      const res = await getJson<{ overrides: Override[] }>(`/api/agent-overrides?tenantId=${ctx.tenantId}&agentAccountId=${agentId}`);
      if (res.ok) setOverrides((s) => ({ ...s, [agentId]: res.data.overrides }));
      else setOvErr(loadError(res.status));
    }
  }

  async function createOverride(agentId: string) {
    const price = Number(ovPrice);
    if (!ovVariantId || !Number.isInteger(price) || price < 0) return;
    setPending("ov-create"); setOvErr("");
    const res = await postJson("/api/agent-overrides", {
      tenantId: ctx.tenantId, agentAccountId: agentId, variantId: ovVariantId, price,
      validFrom: ovHasFrom ? isoDate(ovFrom) : null, validTo: ovHasTo ? isoDate(ovTo) : null,
    });
    setPending(null);
    if (!res.ok) { setOvErr((res.error && OVERRIDE_ERR_FA[res.error]) || actionError(res.status)); return; }
    resetOvForm();
    const r = await getJson<{ overrides: Override[] }>(`/api/agent-overrides?tenantId=${ctx.tenantId}&agentAccountId=${agentId}`);
    if (r.ok) setOverrides((s) => ({ ...s, [agentId]: r.data.overrides }));
  }

  function startEditOverride(o: Override) {
    setOvEditId(o.id); setOvEditPrice(o.price); setOvErr("");
    setOvEditHasFrom(!!o.validFrom); setOvEditFrom(o.validFrom ? toJalali(new Date(o.validFrom)) : todayJalali());
    setOvEditHasTo(!!o.validTo); setOvEditTo(o.validTo ? toJalali(new Date(o.validTo)) : todayJalali());
  }

  async function saveEditOverride(agentId: string) {
    const price = Number(ovEditPrice);
    if (!ovEditId || !Number.isInteger(price) || price < 0) return;
    setPending("ov-edit" + ovEditId); setOvErr("");
    const res = await postJson("/api/agent-overrides", {
      tenantId: ctx.tenantId, id: ovEditId, price,
      validFrom: ovEditHasFrom ? isoDate(ovEditFrom) : null, validTo: ovEditHasTo ? isoDate(ovEditTo) : null,
    }, "PATCH");
    setPending(null);
    if (!res.ok) { setOvErr((res.error && OVERRIDE_ERR_FA[res.error]) || actionError(res.status)); return; }
    setOvEditId(null);
    const r = await getJson<{ overrides: Override[] }>(`/api/agent-overrides?tenantId=${ctx.tenantId}&agentAccountId=${agentId}`);
    if (r.ok) setOverrides((s) => ({ ...s, [agentId]: r.data.overrides }));
  }

  async function removeOverride(agentId: string, id: string) {
    setPending("ov-del" + id); setOvErr("");
    const res = await postJson("/api/agent-overrides", { tenantId: ctx.tenantId, id }, "DELETE");
    setPending(null);
    if (!res.ok) { setOvErr((res.error && OVERRIDE_ERR_FA[res.error]) || actionError(res.status)); return; }
    const r = await getJson<{ overrides: Override[] }>(`/api/agent-overrides?tenantId=${ctx.tenantId}&agentAccountId=${agentId}`);
    if (r.ok) setOverrides((s) => ({ ...s, [agentId]: r.data.overrides }));
  }

  return (
    <>
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

        <label htmlFor="as">پشتیبانِ ثابت (اختیاری)</label>
        <select id="as" value={assignedStaffUserId} onChange={(e) => setAssignedStaffUserId(e.target.value)}>
          <option value="">— بدونِ پشتیبانِ ثابت —</option>
          {staffOptions.map((s) => <option key={s.userId} value={s.userId}>{staffLabel(s)}</option>)}
        </select>

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
              {!a.isActive && <span className="badge" style={{ marginInlineStart: "var(--sp-2)" }}>غیرفعال</span>}
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
            {a.creditLimit != null && <> · سقفِ اعتبار: {formatMoney(a.creditLimit, ctx.currencyUnit)}</>}
            {a.autoApproveLimit != null && <> · تأییدِ خودکارِ اختصاصی: {formatMoney(a.autoApproveLimit, ctx.currencyUnit)}</>}
          </div>
          <div style={{ marginTop: "var(--sp-2)" }}>
            {a.users.map((u) => (
              <div key={u.userId} className="subtle num">
                {u.phone}{u.email ? ` · ${u.email}` : ""}
              </div>
            ))}
          </div>

          <div style={{ marginTop: "var(--sp-2)" }}>
            {editStaffFor === a.id ? (
              <div className="row row--start" style={{ gap: "var(--sp-2)" }}>
                <select value={editStaffId} onChange={(e) => setEditStaffId(e.target.value)} style={{ maxWidth: 240 }}>
                  <option value="">— بدونِ پشتیبانِ ثابت —</option>
                  {staffOptions.map((s) => <option key={s.userId} value={s.userId}>{staffLabel(s)}</option>)}
                </select>
                <button className="primary" disabled={pending === "staff" + a.id} onClick={() => saveStaff(a.id)}>
                  {pending === "staff" + a.id && <span className="spinner" aria-hidden="true" />}ذخیره
                </button>
                <button className="ghost" onClick={() => setEditStaffFor(null)}>انصراف</button>
              </div>
            ) : (
              <div className="row row--start" style={{ gap: "var(--sp-2)" }}>
                <span className="subtle">
                  پشتیبانِ ثابت: {a.assignedStaffName ?? a.assignedStaffPhone ?? "تعیین‌نشده"}
                </span>
                <button className="ghost" onClick={() => startEditStaff(a)}>ویرایش</button>
              </div>
            )}
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

          <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-2)", borderTop: "1px solid var(--line)" }}>
            <button className="ghost" onClick={() => toggleOverridePanel(a.id)}>
              {overrideFor === a.id ? "بستنِ استثنای قیمت" : "استثنای قیمتِ این نماینده"}
            </button>

            {overrideFor === a.id && (
              <div style={{ marginTop: "var(--sp-3)" }}>
                <div className="banner banner--info">
                  <Icon name="info" />
                  <span>
                    استثنا از لیستِ قیمتِ همین نماینده هم ارجح است — برای فقط همین نماینده، فقط همین کالا.
                    بازه‌ی اعتبار اختیاری است؛ خالی یعنی نامحدود.
                  </span>
                </div>

                {ovErr && <div className="err" style={{ marginBottom: "var(--sp-2)" }}><Icon name="alert" />{ovErr}</div>}

                {(overrides[a.id] ?? []).length === 0 ? (
                  <p className="empty">استثنایی برای این نماینده ثبت نشده.</p>
                ) : overrides[a.id].map((o) => (
                  <div className="card" key={o.id}>
                    {ovEditId === o.id ? (
                      <div className="row row--start row--stack-mobile" style={{ gap: "var(--sp-2)" }}>
                        <span className="subtle">{o.productName} ({o.productCode})</span>
                        <input type="number" min={0} value={ovEditPrice} onChange={(e) => setOvEditPrice(e.target.value)}
                          placeholder="قیمت" style={{ maxWidth: 150 }} />
                        <label className="row row--start" style={{ gap: "var(--sp-1)" }}>
                          <input type="checkbox" checked={ovEditHasFrom} onChange={(e) => setOvEditHasFrom(e.target.checked)} />از
                        </label>
                        {ovEditHasFrom && <JalaliDateInput label="" value={ovEditFrom} onChange={setOvEditFrom} currentYear={todayJalali().jy + 1} />}
                        <label className="row row--start" style={{ gap: "var(--sp-1)" }}>
                          <input type="checkbox" checked={ovEditHasTo} onChange={(e) => setOvEditHasTo(e.target.checked)} />تا
                        </label>
                        {ovEditHasTo && <JalaliDateInput label="" value={ovEditTo} onChange={setOvEditTo} currentYear={todayJalali().jy + 1} />}
                        <button className="primary" onClick={() => saveEditOverride(a.id)} aria-busy={pending === "ov-edit" + o.id} disabled={pending === "ov-edit" + o.id}>
                          {pending === "ov-edit" + o.id && <span className="spinner" aria-hidden="true" />}ذخیره
                        </button>
                        <button className="ghost" onClick={() => setOvEditId(null)}>انصراف</button>
                      </div>
                    ) : (
                      <div className="row row--start row--stack-mobile" style={{ gap: "var(--sp-2)" }}>
                        <span>{o.productName} <span className="subtle">({o.productCode})</span></span>
                        <span className="badge badge--ok">{formatMoney(Number(o.price), ctx.currencyUnit)}</span>
                        <span className="subtle">
                          {o.validFrom || o.validTo
                            ? `${o.validFrom ? formatJalaliDate(o.validFrom) : "ابتدا"} تا ${o.validTo ? formatJalaliDate(o.validTo) : "بی‌پایان"}`
                            : "بدونِ محدودیتِ تاریخ"}
                        </span>
                        <button className="ghost" onClick={() => startEditOverride(o)}>ویرایش</button>
                        <DeleteButton pending={pending === "ov-del" + o.id} onConfirm={() => removeOverride(a.id, o.id)} />
                      </div>
                    )}
                  </div>
                ))}

                <div className="card">
                  <div className="grid2">
                    <div>
                      <label htmlFor={`ov-var-${a.id}`}>کالا</label>
                      <select id={`ov-var-${a.id}`} value={ovVariantId} onChange={(e) => setOvVariantId(e.target.value)}>
                        <option value="">انتخاب…</option>
                        {variants.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`ov-price-${a.id}`}>قیمتِ استثنا (ریال)</label>
                      <input id={`ov-price-${a.id}`} type="number" min={0} inputMode="numeric" value={ovPrice} onChange={(e) => setOvPrice(e.target.value)} />
                    </div>
                  </div>
                  <div className="row row--start" style={{ gap: "var(--sp-3)", marginTop: "var(--sp-2)" }}>
                    <label className="row row--start" style={{ gap: "var(--sp-1)" }}>
                      <input type="checkbox" checked={ovHasFrom} onChange={(e) => setOvHasFrom(e.target.checked)} />تاریخِ شروع دارد
                    </label>
                    {ovHasFrom && <JalaliDateInput label="از" value={ovFrom} onChange={setOvFrom} currentYear={todayJalali().jy + 1} />}
                  </div>
                  <div className="row row--start" style={{ gap: "var(--sp-3)", marginTop: "var(--sp-2)" }}>
                    <label className="row row--start" style={{ gap: "var(--sp-1)" }}>
                      <input type="checkbox" checked={ovHasTo} onChange={(e) => setOvHasTo(e.target.checked)} />تاریخِ پایان دارد
                    </label>
                    {ovHasTo && <JalaliDateInput label="تا" value={ovTo} onChange={setOvTo} currentYear={todayJalali().jy + 1} />}
                  </div>
                  <button className="primary" onClick={() => createOverride(a.id)} aria-busy={pending === "ov-create"}
                    disabled={pending === "ov-create" || !ovVariantId || !ovPrice}
                    style={{ width: "100%", marginTop: "var(--sp-4)" }}>
                    {pending === "ov-create" && <span className="spinner" aria-hidden="true" />}افزودنِ استثنا
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
