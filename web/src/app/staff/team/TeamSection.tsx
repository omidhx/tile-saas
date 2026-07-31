"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../../Icon";
import MessageBanner from "../../MessageBanner";
import { getJson, postJson, loadError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";
import { STAFF_PAGES } from "@/lib/staffPages";
import DeleteButton from "../../DeleteButton";

type Member = {
  membershipId: string; userId: string; phone: string; email: string | null; fullName: string | null;
  role: "staff" | "admin"; isActive: boolean; canManageAccess: boolean; allowedPages: string[];
};

const FA: Record<string, string> = {
  seat_limit: "سقفِ تعدادِ اعضای تیمِ این اشتراک پر شده — برای افزایش با پشتیبانی تماس بگیرید.",
  already_member: "این کاربر از قبل عضوِ فعالِ تیم است.",
  email_taken: "این ایمیل قبلاً برای کاربرِ دیگری ثبت شده.",
  last_admin: "این تنها مدیرِ فعال است — باید حداقل یک مدیر باقی بماند.",
  last_deputy: "این تنها مدیرِ دسترسیِ فعال است — باید حداقل یک نفر بتواند دسترسیِ بقیه را مدیریت کند.",
  linked_to_agent: "این کاربر به یک نمایندگی وصل است — اول از صفحه‌ی نمایندگی‌ها جدایش کنید.",
};

export default function TeamSection({ ctx }: { ctx: Ctx }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<"staff" | "admin">("staff");
  const [deputy, setDeputy] = useState(false);
  const [pages, setPages] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState(""); // فقط موفقیت — MessageBanner با تشخیصِ متنی رندر می‌کند
  const [err, setErr] = useState("");
  const [tempPassword, setTempPassword] = useState<{ phone: string; password: string } | null>(null);

  // ویرایشِ چک‌لیستِ صفحه‌های یک عضوِ staffِ موجود (درجا، بدونِ فرمِ جدا)
  const [editPagesFor, setEditPagesFor] = useState<string | null>(null);
  const [editPages, setEditPages] = useState<string[]>([]);

  // ویرایشِ درجای نامِ یک عضوِ موجود — برای تصحیحِ تایپو یا پرکردنِ نامِ ثبت‌نشده
  const [editNameFor, setEditNameFor] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async (tenantId: string) => {
    const res = await getJson<{ members: Member[] }>(`/api/team?tenantId=${tenantId}`);
    if (res.ok) { setMembers(res.data.members); setLoadErr(""); } else setLoadErr(loadError(res.status));
    setLoaded(true);
  }, []);

  useEffect(() => { load(ctx.tenantId); }, [ctx.tenantId, load]);

  function togglePage(list: string[], key: string): string[] {
    return list.includes(key) ? list.filter((p) => p !== key) : [...list, key];
  }

  async function invite() {
    if (!phone.trim()) return;
    setPending("invite"); setMsg(""); setErr(""); setTempPassword(null);
    const res = await postJson("/api/team", {
      tenantId: ctx.tenantId, phone: phone.trim(), email: email.trim() || undefined,
      fullName: fullName.trim() || undefined, role,
      canManageAccess: role === "admin" ? deputy : undefined,
      allowedPages: role === "staff" ? pages : undefined,
    });
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `دعوت انجام نشد (خطای ${res.status}).`);
      return;
    }
    const data = res.data as { created: boolean; tempPassword: string | null };
    // نقش هم باید به پیش‌فرض برگردد — وگرنه بعدِ دعوتِ یک «مدیر»، عضوِ بعدی هم
    // بی‌آنکه کسی متوجه شود با همان نقشِ مدیر دعوت می‌شود.
    setPhone(""); setEmail(""); setFullName(""); setRole("staff"); setDeputy(false); setPages([]);
    if (data.created && data.tempPassword) setTempPassword({ phone, password: data.tempPassword });
    setMsg(data.created ? "عضو ساخته شد." : "دسترسی به کاربرِ موجود اضافه شد.");
    await load(ctx.tenantId);
  }

  async function patch(membershipId: string, body: object) {
    setPending(membershipId); setMsg(""); setErr("");
    const res = await postJson("/api/team", { tenantId: ctx.tenantId, membershipId, ...body }, "PATCH");
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `تغییر انجام نشد (خطای ${res.status}).`);
      return false;
    }
    await load(ctx.tenantId);
    return true;
  }

  async function remove(membershipId: string) {
    setPending(membershipId); setMsg(""); setErr("");
    const res = await postJson("/api/team", { tenantId: ctx.tenantId, membershipId }, "DELETE");
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `حذف انجام نشد (خطای ${res.status}).`);
      return;
    }
    setMsg("عضو حذف شد.");
    await load(ctx.tenantId);
  }

  function startEditPages(m: Member) { setEditPagesFor(m.membershipId); setEditPages(m.allowedPages); setMsg(""); setErr(""); }
  async function savePages(membershipId: string) {
    if (await patch(membershipId, { allowedPages: editPages })) setEditPagesFor(null);
  }

  function startEditName(m: Member) { setEditNameFor(m.membershipId); setEditName(m.fullName ?? ""); setMsg(""); setErr(""); }
  async function saveName(membershipId: string) {
    if (await patch(membershipId, { fullName: editName })) setEditNameFor(null);
  }

  return (
    <>
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          کسی که با موبایلی که در سامانه نیست دعوت شود، رمزِ یک‌بارمصرف می‌گیرد
          (پیامک + ایمیلِ اختیاری) — و همین‌جا هم یک‌بار نشان داده می‌شود، برای
          وقتی هیچ‌کدام از کانال‌ها نرسید. کاربرِ از‌قبل‌موجود با رمزِ خودش وارد می‌شود.
          «مدیرِ دسترسی» تنها کسی است که می‌تواند دسترسیِ بقیه را دست‌کاری کند —
          خودِ admin‌بودن برای این کار کافی نیست.
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

      <h2>دعوتِ عضوِ تازه</h2>
      <div className="card">
        <label htmlFor="ph">موبایل</label>
        <input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="۰۹۱۲۰۰۰۰۰۰۰" />

        <label htmlFor="fn">نام و نام‌خانوادگی</label>
        <input id="fn" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="مثلاً: رضا احمدی" />

        <label htmlFor="em">ایمیل (اختیاری — راهِ دومِ ورود اگر پیامک نرسید)</label>
        <input id="em" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />

        <label htmlFor="rl">نقش</label>
        <select id="rl" value={role} onChange={(e) => setRole(e.target.value as "staff" | "admin")}>
          <option value="staff">پشتیبان — کارِ روزمره</option>
          <option value="admin">مدیر — تیم/نمایندگی/انبار هم دستش باشد</option>
        </select>

        {role === "admin" ? (
          <label className="row row--start" style={{ marginTop: "var(--sp-3)", cursor: "pointer", gap: "var(--sp-2)", justifyContent: "flex-start" }}>
            <input type="checkbox" checked={deputy} onChange={(e) => setDeputy(e.target.checked)} style={{ width: "auto", minHeight: 0 }} />
            <span>مدیرِ دسترسی است — اجازه دارد دسترسیِ بقیه را مدیریت کند (دعوت، نقش، حذف، چک‌لیستِ صفحه‌ها)</span>
          </label>
        ) : (
          <>
            <label style={{ marginTop: "var(--sp-3)" }}>
              دسترسی به بخش‌ها <span className="subtle">(خالی = دسترسیِ کامل)</span>
            </label>
            <div className="pick-list">
              {STAFF_PAGES.map((p) => (
                <label key={p.key} style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", margin: 0, cursor: "pointer", fontWeight: 400 }}>
                  <input type="checkbox" checked={pages.includes(p.key)} onChange={() => setPages((s) => togglePage(s, p.key))}
                         style={{ width: "auto", minHeight: 0 }} />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
          </>
        )}

        <button className="primary" onClick={invite} aria-busy={pending === "invite"}
                disabled={pending === "invite" || !phone.trim()}
                style={{ width: "100%", marginTop: "var(--sp-4)" }}>
          {pending === "invite" && <span className="spinner" aria-hidden="true" />}دعوت
        </button>
      </div>

      <h2>اعضا</h2>
      {loaded && members.length === 0 && <p className="empty">عضوی ثبت نشده.</p>}
      {members.map((m) => (
        <div className="card" key={m.membershipId}>
          <div className="row">
            <span>
              {editNameFor === m.membershipId ? (
                <span className="row row--start" style={{ gap: "var(--sp-2)" }}>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)}
                         placeholder="نام و نام‌خانوادگی" aria-label={`نامِ ${m.phone}`} style={{ maxWidth: 200 }} autoFocus />
                  <button className="primary" disabled={pending === m.membershipId} onClick={() => saveName(m.membershipId)}>
                    {pending === m.membershipId && <span className="spinner" aria-hidden="true" />}ذخیره
                  </button>
                  <button className="ghost" onClick={() => setEditNameFor(null)}>انصراف</button>
                </span>
              ) : (
                <>
                  <strong>{m.fullName ?? <span className="subtle">(بدونِ نام)</span>}</strong>{" "}
                  <span className="subtle num">{m.phone}</span>
                  {m.email && <span className="subtle"> · {m.email}</span>}
                </>
              )}
              {!m.isActive && <span className="badge" style={{ marginInlineStart: "var(--sp-2)" }}>غیرفعال</span>}
            </span>
            <span className="row row--start">
              {m.role === "admin" && m.canManageAccess && <span className="badge badge--ok">مدیرِ دسترسی</span>}
              <span className={`badge${m.role === "admin" ? " badge--ok" : ""}`}>{m.role === "admin" ? "مدیر" : "پشتیبان"}</span>
            </span>
          </div>

          {m.role === "staff" && (
            editPagesFor === m.membershipId ? (
              <div style={{ marginTop: "var(--sp-2)" }}>
                <div className="pick-list">
                  {STAFF_PAGES.map((p) => (
                    <label key={p.key} style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", margin: 0, cursor: "pointer", fontWeight: 400 }}>
                      <input type="checkbox" checked={editPages.includes(p.key)}
                             onChange={() => setEditPages((s) => togglePage(s, p.key))} style={{ width: "auto", minHeight: 0 }} />
                      <span>{p.label}</span>
                    </label>
                  ))}
                </div>
                <div className="row row--start" style={{ marginTop: "var(--sp-2)" }}>
                  <button className="primary" disabled={pending === m.membershipId} onClick={() => savePages(m.membershipId)}>
                    {pending === m.membershipId && <span className="spinner" aria-hidden="true" />}ذخیره
                  </button>
                  <button className="ghost" onClick={() => setEditPagesFor(null)}>انصراف</button>
                </div>
              </div>
            ) : (
              <div className="muted" style={{ marginTop: "var(--sp-1)" }}>
                {m.allowedPages.length === 0 ? "دسترسیِ کامل" : `دسترسی: ${m.allowedPages.map((k) => STAFF_PAGES.find((p) => p.key === k)?.label ?? k).join("، ")}`}
              </div>
            )
          )}

          <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
            {editNameFor !== m.membershipId && (
              <button className="ghost" disabled={pending === m.membershipId} onClick={() => startEditName(m)}>
                ویرایشِ نام
              </button>
            )}
            {m.role === "staff" && editPagesFor !== m.membershipId && (
              <button className="ghost" disabled={pending === m.membershipId} onClick={() => startEditPages(m)}>
                ویرایشِ دسترسی
              </button>
            )}
            <button className="ghost" disabled={pending === m.membershipId}
                    onClick={() => patch(m.membershipId, { role: m.role === "admin" ? "staff" : "admin" })}>
              {m.role === "admin" ? "پشتیبانِ ساده کن" : "مدیر کن"}
            </button>
            {m.role === "admin" && (
              <button className="ghost" disabled={pending === m.membershipId}
                      onClick={() => patch(m.membershipId, { canManageAccess: !m.canManageAccess })}>
                {m.canManageAccess ? "نقشِ مدیرِ دسترسی را بردار" : "مدیرِ دسترسی کن"}
              </button>
            )}
            <button className="ghost" disabled={pending === m.membershipId} aria-busy={pending === m.membershipId}
                    onClick={() => patch(m.membershipId, { isActive: !m.isActive })}>
              {pending === m.membershipId && <span className="spinner" aria-hidden="true" />}
              {m.isActive ? "غیرفعال کن" : "فعال کن"}
            </button>
            <DeleteButton pending={pending === m.membershipId} onConfirm={() => remove(m.membershipId)} />
          </div>
        </div>
      ))}
    </>
  );
}
