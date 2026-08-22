"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "../../Icon";
import LogoutButton from "../../LogoutButton";
import { postJson, actionError } from "@/lib/api";

/**
 * روزِ صفرِ یک مشتریِ تازه‌ی SaaS — ساختِ کارخانه (tenant) + اولین مدیرش، بدونِ
 * SQL دستی. این صفحه tenant-agnostic است (بر خلافِ بقیه‌ی پنل) چون خودِ کاربر
 * ممکن است هنوز هیچ عضویتی نداشته باشد — `useContexts` اینجا کار نمی‌کند.
 */
type Access = "loading" | "denied" | "ok";

const FA: Record<string, string> = {
  invalid: "نام، اسلاگ و موبایلِ مدیرِ اول الزامی‌اند.",
  slug_taken: "این اسلاگ قبلاً برای کارخانه‌ی دیگری استفاده شده.",
  email_taken: "این ایمیل قبلاً برای کاربرِ دیگری ثبت شده.",
};

export default function PlatformTenantsPage() {
  const router = useRouter();
  const [access, setAccess] = useState<Access>("loading");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminPhone, setAdminPhone] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState<{ slug: string; phone: string; tempPassword: string | null } | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me");
      if (res.status === 401) { router.push("/login"); return; }
      const data = await res.json().catch(() => ({}));
      setAccess(data?.isPlatformAdmin ? "ok" : "denied");
    })();
  }, [router]);

  const ready = name.trim() && slug.trim() && adminPhone.trim();

  async function submit() {
    if (!ready) return;
    setPending(true); setErr(""); setCreated(null);
    const res = await postJson("/api/platform/tenants", {
      name: name.trim(), slug: slug.trim(), adminPhone: adminPhone.trim(),
      adminEmail: adminEmail.trim() || undefined, adminFullName: adminFullName.trim() || undefined,
    });
    setPending(false);
    if (!res.ok) { setErr((res.error && FA[res.error]) || actionError(res.status)); return; }
    const data = res.data as { tenantId: string; tempPassword: string | null };
    setCreated({ slug: slug.trim(), phone: adminPhone.trim(), tempPassword: data.tempPassword });
    setName(""); setSlug(""); setAdminPhone(""); setAdminEmail(""); setAdminFullName("");
  }

  if (access === "loading") return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;
  if (access === "denied")
    return (
      <main>
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>این بخش فقط برای مدیرِ پلتفرم است.</span>
        </div>
      </main>
    );

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>ساختِ کارخانه‌ی تازه</h1>
          <p className="muted" style={{ margin: 0 }}>مدیرِ پلتفرم</p>
        </div>
        <nav><LogoutButton /></nav>
      </div>

      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          این فرم یک کارخانه (tenant) + اولین حسابِ مدیرش را می‌سازد. مدیرِ اول
          «مدیرِ دسترسی» هم هست، پس بلافاصله می‌تواند بقیه‌ی تیم/نمایندگی/انبار را
          از همان پنلِ خودش (بدونِ SQL) بسازد.
        </span>
      </div>

      {created && (
        <div className="banner banner--ok" role="status" style={{ flexDirection: "column", alignItems: "flex-start", gap: "var(--sp-2)" }}>
          <span><Icon name="check" /> کارخانه ساخته شد — اسلاگ: <span className="num">{created.slug}</span></span>
          {created.tempPassword ? (
            <>
              <span>رمزِ یک‌بارمصرفِ <span className="num">{created.phone}</span>:</span>
              <strong className="num" style={{ fontSize: "1.2rem", letterSpacing: ".05em" }}>{created.tempPassword}</strong>
              <span className="subtle">این رمز فقط همین یک‌بار نشان داده می‌شود.</span>
            </>
          ) : (
            <span className="subtle">این موبایل قبلاً در سامانه بود — با رمزِ فعلیِ خودش وارد می‌شود.</span>
          )}
        </div>
      )}
      {err && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{err}</span></div>}

      <div className="card">
        <label htmlFor="tn">نامِ کارخانه</label>
        <input id="tn" value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: کاشی البرز" />

        <label htmlFor="ts">اسلاگ <span className="subtle">(برای لینکِ کاتالوگِ عمومی، فقط حروف/عدد/خط‌تیره)</span></label>
        <input id="ts" value={slug} onChange={(e) => setSlug(e.target.value)}
               placeholder="tile-alborz" className="num" style={{ direction: "ltr" }} />

        <label htmlFor="ap" style={{ marginTop: "var(--sp-3)" }}>موبایلِ مدیرِ اول</label>
        <input id="ap" value={adminPhone} onChange={(e) => setAdminPhone(e.target.value)} placeholder="۰۹۱۲۰۰۰۰۰۰۰" />

        <label htmlFor="an">نام و نام‌خانوادگیِ مدیرِ اول (اختیاری)</label>
        <input id="an" value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} />

        <label htmlFor="ae">ایمیلِ مدیرِ اول (اختیاری)</label>
        <input id="ae" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="name@example.com" />

        <button className="primary" onClick={submit} aria-busy={pending} disabled={pending || !ready}
                style={{ width: "100%", marginTop: "var(--sp-4)" }}>
          {pending && <span className="spinner" aria-hidden="true" />}ساختِ کارخانه
        </button>
      </div>
    </main>
  );
}
