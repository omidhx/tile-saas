"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "../Icon";

/** پیامِ خطا از روی **status** ساخته می‌شود، نه رشته‌ی سرور.
 *  سرور برای ۴۰۰ رشته‌ی `"invalid"` برمی‌گرداند و همان خام به کاربر نشان داده می‌شد. */
function loginError(status: number): string {
  if (status === 401) return "شماره موبایل یا رمز عبور اشتباه است.";
  if (status === 400) return "شماره موبایل و رمز عبور را کامل وارد کنید.";
  if (status === 429) return "تلاش‌های بیش از حد. چند دقیقه صبر کنید و دوباره امتحان کنید.";
  return `ورود انجام نشد (خطای ${status}). اگر تکرار شد به پشتیبانی اطلاع دهید.`;
}

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setPending(true); // pending state، نه optimistic (spec ۱۱.۱)
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      if (!res.ok) { setErr(loginError(res.status)); return; }

      // مقصد بر اساس نقش: قبلاً همه به /reserve می‌رفتند، یعنی پشتیبان روی صفحه‌ی
      // نماینده می‌نشست و بنرِ «به نمایندگی‌ای وصل نیستی» می‌گرفت — درست ولی گیج‌کننده.
      const me = await fetch("/api/me").then((r) => r.json()).catch(() => null);
      const contexts = me?.contexts ?? [];
      const isStaff = contexts.some((c: { role?: string }) => c.role === "staff" || c.role === "admin");
      // v9: حسابِ خالصِ مدیرِ پلتفرم (بدونِ عضویت در هیچ tenantی) نباید به
      // /reserve بیفتد — آنجا فقط بنرِ «به نمایندگی‌ای وصل نیستی» می‌گیرد.
      const isPurePlatformAdmin = contexts.length === 0 && me?.isPlatformAdmin;
      router.push(isStaff ? "/staff" : isPurePlatformAdmin ? "/platform/tenants" : "/reserve");
    } catch {
      setErr("ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید.");
    } finally {
      setPending(false);
    }
  }

  return (
    // فرمِ ورود تنها صفحه‌ای است که محتوایش کم است: عرضِ ۹۰۰px و چسبیده به بالا
    // برای یک فرمِ دوفیلدی غلط بود.
    <main className="auth-shell">
      <div className="auth-box">
        <h1>ورود به پنل</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          سامانه‌ی موجودی، رزرو و سفارشِ نمایندگان
        </p>

        <form className="card" onSubmit={submit} noValidate>
          <label htmlFor="phone">شماره موبایل یا ایمیل</label>
          <input id="phone" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                 autoComplete="username" placeholder="۰۹۱۲۰۰۰۰۰۰۰ یا ایمیل"
                 aria-invalid={err ? true : undefined} required />

          <label htmlFor="pw">رمز عبور</label>
          <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete="current-password" aria-invalid={err ? true : undefined} required />

          {/* خطا **کنارِ فرم** و قبل از دکمه، نه ته صفحه */}
          {err && (
            <div className="banner banner--error" role="alert" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
              <Icon name="alert" /><span>{err}</span>
            </div>
          )}

          <button type="submit" className="primary" disabled={pending} aria-busy={pending}
                  style={{ width: "100%", marginTop: "var(--sp-4)" }}>
            {pending && <span className="spinner" aria-hidden="true" />}
            {pending ? "در حال ورود…" : "ورود"}
          </button>
        </form>

        <p style={{ textAlign: "center", margin: "var(--sp-3) 0 0" }}>
          <Link href="/reset">رمز عبور را فراموش کرده‌اید؟</Link>
        </p>
        <p className="subtle" style={{ textAlign: "center" }}>
          حساب کاربری را کارخانه می‌سازد — ثبت‌نام عمومی نداریم.
        </p>
      </div>
    </main>
  );
}
