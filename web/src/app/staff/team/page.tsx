"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import NavMenu from "../../NavMenu";
import MessageBanner from "../../MessageBanner";
import { getJson, postJson, loadError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";

type Member = { membershipId: string; userId: string; phone: string; email: string | null; role: "staff" | "admin"; isActive: boolean };

const FA: Record<string, string> = {
  seat_limit: "سقفِ تعدادِ اعضای تیمِ این اشتراک پر شده — برای افزایش با پشتیبانی تماس بگیرید.",
  already_member: "این کاربر از قبل عضوِ فعالِ تیم است.",
  email_taken: "این ایمیل قبلاً برای کاربرِ دیگری ثبت شده.",
  last_admin: "این تنها مدیرِ فعال است — باید حداقل یک مدیر باقی بماند.",
};

export default function TeamPage() {
  const { ctx, state } = useContexts("staff");
  const [members, setMembers] = useState<Member[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"staff" | "admin">("staff");
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState(""); // فقط موفقیت — MessageBanner با تشخیصِ متنی رندر می‌کند
  const [err, setErr] = useState("");
  const [tempPassword, setTempPassword] = useState<{ phone: string; password: string } | null>(null);

  const load = useCallback(async (tenantId: string) => {
    const res = await getJson<{ members: Member[] }>(`/api/team?tenantId=${tenantId}`);
    if (res.ok) { setMembers(res.data.members); setLoadErr(""); } else setLoadErr(loadError(res.status));
    setLoaded(true);
  }, []);

  useEffect(() => { if (ctx?.role === "admin") load(ctx.tenantId); }, [ctx, load]);

  async function invite() {
    if (!ctx || !phone.trim()) return;
    setPending("invite"); setMsg(""); setErr(""); setTempPassword(null);
    const res = await postJson("/api/team", { tenantId: ctx.tenantId, phone: phone.trim(), email: email.trim() || undefined, role });
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `دعوت انجام نشد (خطای ${res.status}).`);
      return;
    }
    const data = res.data as { created: boolean; tempPassword: string | null };
    setPhone(""); setEmail("");
    if (data.created && data.tempPassword) setTempPassword({ phone, password: data.tempPassword });
    setMsg(data.created ? "عضو ساخته شد." : "دسترسی به کاربرِ موجود اضافه شد.");
    await load(ctx.tenantId);
  }

  async function setStatus(membershipId: string, isActive: boolean) {
    if (!ctx) return;
    setPending(membershipId); setMsg(""); setErr("");
    const res = await postJson("/api/team", { tenantId: ctx.tenantId, membershipId, isActive }, "PATCH");
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `تغییر انجام نشد (خطای ${res.status}).`);
      return;
    }
    await load(ctx.tenantId);
  }

  async function setRoleFor(membershipId: string, newRole: "staff" | "admin") {
    if (!ctx) return;
    setPending(membershipId); setMsg(""); setErr("");
    const res = await postJson("/api/team", { tenantId: ctx.tenantId, membershipId, role: newRole }, "PATCH");
    setPending(null);
    if (!res.ok) {
      setErr((res.error && FA[res.error]) || `تغییر انجام نشد (خطای ${res.status}).`);
      return;
    }
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
          <h1>تیمِ کارخانه</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu /></nav>
      </div>

      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          کسی که با موبایلی که در سامانه نیست دعوت شود، رمزِ یک‌بارمصرف می‌گیرد
          (پیامک + ایمیلِ اختیاری) — و همین‌جا هم یک‌بار نشان داده می‌شود، برای
          وقتی هیچ‌کدام از کانال‌ها نرسید. کاربرِ از‌قبل‌موجود با رمزِ خودش وارد می‌شود.
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
              <strong className="num">{m.phone}</strong>
              {m.email && <span className="subtle"> · {m.email}</span>}
              {!m.isActive && <span className="badge" style={{ marginInlineStart: ".4rem" }}>غیرفعال</span>}
            </span>
            <span className={`badge${m.role === "admin" ? " badge--ok" : ""}`}>{m.role === "admin" ? "مدیر" : "پشتیبان"}</span>
          </div>
          <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
            <button className="ghost" disabled={pending === m.membershipId}
                    onClick={() => setRoleFor(m.membershipId, m.role === "admin" ? "staff" : "admin")}>
              {m.role === "admin" ? "پشتیبانِ ساده کن" : "مدیر کن"}
            </button>
            <button className="ghost" disabled={pending === m.membershipId} aria-busy={pending === m.membershipId}
                    onClick={() => setStatus(m.membershipId, !m.isActive)}>
              {pending === m.membershipId && <span className="spinner" aria-hidden="true" />}
              {m.isActive ? "غیرفعال کن" : "فعال کن"}
            </button>
          </div>
        </div>
      ))}
    </main>
  );
}
