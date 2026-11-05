"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../../Icon";
import MessageBanner from "../../MessageBanner";
import { getJson, postJson, loadError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";
import DeleteButton from "../../DeleteButton";

type Member = {
  membershipId: string; userId: string; phone: string; email: string | null; fullName: string | null;
  role: "staff" | "admin"; isActive: boolean;
};

const FA: Record<string, string> = {
  seat_limit: "سقفِ تعدادِ اعضای تیمِ این اشتراک پر شده — برای افزایش با پشتیبانی تماس بگیرید.",
  already_member: "این کاربر از قبل عضوِ فعالِ تیم است.",
  email_taken: "این ایمیل قبلاً برای کاربرِ دیگری ثبت شده.",
  last_admin: "این تنها مدیرِ فعال است — باید حداقل یک مدیر باقی بماند.",
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
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState(""); // فقط موفقیت — MessageBanner با تشخیصِ متنی رندر می‌کند
  const [err, setErr] = useState("");
  const [tempPassword, setTempPassword] = useState<{ phone: string; password: string } | null>(null);

  // ویرایشِ درجای نامِ یک عضوِ موجود — برای تصحیحِ تایپو یا پرکردنِ نامِ ثبت‌نشده
  const [editNameFor, setEditNameFor] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async (tenantId: string) => {
    const res = await getJson<{ members: Member[] }>(`/api/team?tenantId=${tenantId}`);
    if (res.ok) { setMembers(res.data.members); setLoadErr(""); } else setLoadErr(loadError(res.status));
    setLoaded(true);
  }, []);

  useEffect(() => { load(ctx.tenantId); }, [ctx.tenantId, load]);

  async function invite() {
    if (!phone.trim()) return;
    setPending("invite"); setMsg(""); setErr(""); setTempPassword(null);
    const res = await postJson("/api/team", {
      tenantId: ctx.tenantId, phone: phone.trim(), email: email.trim() || undefined,
      fullName: fullName.trim() || undefined, role,
    });
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `دعوت انجام نشد (خطای ${res.status}).`);
      return;
    }
    const data = res.data as { created: boolean; tempPassword: string | null };
    // نقش هم باید به پیش‌فرض برگردد — وگرنه بعدِ دعوتِ یک «مدیر»، عضوِ بعدی هم
    // بی‌آنکه کسی متوجه شود با همان نقشِ مدیر دعوت می‌شود.
    setPhone(""); setEmail(""); setFullName(""); setRole("staff");
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
          (با پیامک) — و همین‌جا هم یک‌بار نشان داده می‌شود، برای وقتی پیامک نرسید.
          کاربرِ از‌قبل‌موجود با رمزِ خودش وارد می‌شود.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      {err && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{err}</span></div>}
      <MessageBanner msg={msg} />

      {tempPassword && (
        <div className="banner banner--ok" role="status" style={{ flexDirection: "column", alignItems: "flex-start", gap: "var(--sp-2)" }}>
          <span><Icon name="check" /> رمزِ یک‌بارمصرفِ <span className="num">{tempPassword.phone}</span>:</span>
          <strong className="num" style={{ fontSize: "1.2rem", letterSpacing: ".05em" }}>{tempPassword.password}</strong>
          <span className="subtle">این رمز فقط همین یک‌بار نشان داده می‌شود — اگر پیامک نرسید، همین را بدهید.</span>
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
              <span className={`badge${m.role === "admin" ? " badge--ok" : ""}`}>{m.role === "admin" ? "مدیر" : "پشتیبان"}</span>
            </span>
          </div>

          <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
            {editNameFor !== m.membershipId && (
              <button className="ghost" disabled={pending === m.membershipId} onClick={() => startEditName(m)}>
                ویرایشِ نام
              </button>
            )}
            <button className="ghost" disabled={pending === m.membershipId}
                    onClick={() => patch(m.membershipId, { role: m.role === "admin" ? "staff" : "admin" })}>
              {m.role === "admin" ? "پشتیبانِ ساده کن" : "مدیر کن"}
            </button>
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
