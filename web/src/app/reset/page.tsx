"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "../Icon";
import { MIN_PASSWORD } from "@/auth/passwordFlows.shared";

const FA: Record<string, string> = {
  invalid_code: "کد اشتباه است یا منقضی شده. کد تازه بگیرید.",
  too_many_attempts: "تلاش‌های بیش از حد روی این کد. کد تازه بگیرید.",
  too_short: `رمز جدید باید حداقل ${MIN_PASSWORD} کاراکتر باشد.`,
  too_many: "درخواست‌های بیش از حد. چند دقیقه صبر کنید.",
};

export default function ResetPage() {
  const router = useRouter();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [next, setNext] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function post(body: object) {
    const res = await fetch("/api/auth/reset", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  }

  async function askCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setPending(true);
    try {
      const r = await post({ phone });
      // پاسخ عمداً بی‌تفاوت است: چه شماره ثبت باشد چه نباشد، به گامِ کد می‌رویم.
      // هر رفتارِ متفاوتی اینجا، فهرستِ شماره‌های نمایندگان را لو می‌دهد.
      if (r.ok || r.status === 400) setStep("code");
      else setErr(FA[r.json.error] ?? `درخواست انجام نشد (خطای ${r.status}).`);
    } catch { setErr("ارتباط با سرور برقرار نشد."); }
    finally { setPending(false); }
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setPending(true);
    try {
      const r = await post({ phone, code, newPassword: next });
      if (r.ok) { setDone(true); return; }
      setErr(FA[r.json.error] ?? `ثبت رمز جدید انجام نشد (خطای ${r.status}).`);
    } catch { setErr("ارتباط با سرور برقرار نشد."); }
    finally { setPending(false); }
  }

  if (done)
    return (
      <main className="auth-shell">
        <div className="auth-box">
          <div className="banner banner--ok" role="status">
            <Icon name="check" />
            <span>رمز عبور عوض شد و همه‌ی دستگاه‌ها از حساب خارج شدند. حالا با رمز جدید وارد شوید.</span>
          </div>
          <button className="primary" style={{ width: "100%" }} onClick={() => router.push("/login")}>
            رفتن به صفحه‌ی ورود
          </button>
        </div>
      </main>
    );

  return (
    <main className="auth-shell">
      <div className="auth-box">
        <h1>بازیابی رمز عبور</h1>

        {step === "phone" ? (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              شماره‌ی موبایلِ ثبت‌شده را وارد کنید تا کد بازیابی پیامک شود.
            </p>
            <form className="card" onSubmit={askCode} noValidate>
              <label htmlFor="ph">شماره موبایل</label>
              <input id="ph" value={phone} onChange={(e) => setPhone(e.target.value)}
                     inputMode="numeric" autoComplete="username" placeholder="۰۹۱۲۰۰۰۰۰۰۰" required />
              {err && (
                <div className="banner banner--error" role="alert" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
                  <Icon name="alert" /><span>{err}</span>
                </div>
              )}
              <button type="submit" className="primary" disabled={pending || !phone.trim()} aria-busy={pending}
                      style={{ width: "100%", marginTop: "var(--sp-4)" }}>
                {pending && <span className="spinner" aria-hidden="true" />}
                {pending ? "در حال ارسال…" : "ارسال کد"}
              </button>
            </form>
          </>
        ) : (
          <>
            {/* متن عمداً «اگر این شماره ثبت باشد» است، نه «کد فرستاده شد» */}
            <div className="banner banner--info">
              <Icon name="info" />
              <span>
                اگر <span className="num">{phone}</span> در سامانه ثبت باشد، کد شش‌رقمی برایش پیامک شد.
                کد تا ۱۰ دقیقه معتبر است.
              </span>
            </div>
            <form className="card" onSubmit={submitNew} noValidate>
              <label htmlFor="cd">کد پیامک‌شده</label>
              <input id="cd" value={code} onChange={(e) => setCode(e.target.value)}
                     inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                     className="num" placeholder="۱۲۳۴۵۶" required />

              <label htmlFor="np">رمز جدید</label>
              <input id="np" type="password" autoComplete="new-password"
                     value={next} onChange={(e) => setNext(e.target.value)} aria-describedby="h" required />
              <div id="h" className="subtle">حداقل {MIN_PASSWORD.toLocaleString("fa-IR")} کاراکتر</div>

              {err && (
                <div className="banner banner--error" role="alert" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
                  <Icon name="alert" /><span>{err}</span>
                </div>
              )}

              <button type="submit" className="primary" aria-busy={pending}
                      disabled={pending || code.trim().length === 0 || next.length < MIN_PASSWORD}
                      style={{ width: "100%", marginTop: "var(--sp-4)" }}>
                {pending && <span className="spinner" aria-hidden="true" />}
                {pending ? "در حال ثبت…" : "ثبت رمز جدید"}
              </button>
              <button type="button" className="ghost" style={{ width: "100%", marginTop: "var(--sp-2)" }}
                      onClick={() => { setStep("phone"); setErr(""); setCode(""); }}>
                شماره را اشتباه زدم / کد تازه می‌خواهم
              </button>
            </form>
          </>
        )}

        <p className="subtle" style={{ textAlign: "center" }}>
          <Link href="/login">بازگشت به ورود</Link>
        </p>
      </div>
    </main>
  );
}
