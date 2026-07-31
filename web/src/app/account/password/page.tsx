"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Icon from "../../Icon";
import { MIN_PASSWORD } from "@/auth/passwordFlows.shared";

const FA: Record<string, string> = {
  wrong_current: "رمز عبور فعلی اشتباه است.",
  too_short: `رمز جدید باید حداقل ${MIN_PASSWORD} کاراکتر باشد.`,
  same_as_current: "رمز جدید با رمز فعلی یکی است — رمزِ متفاوتی انتخاب کنید.",
  too_many: "تلاش‌های بیش از حد. چند دقیقه صبر کنید.",
};

export default function ChangePasswordPage() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [killing, setKilling] = useState(false);
  const [killed, setKilled] = useState(false);
  const [killErr, setKillErr] = useState("");

  async function logoutAll() {
    setKillErr(""); setKilling(true);
    try {
      const res = await fetch("/api/auth/logout-all", { method: "POST" });
      if (res.ok) setKilled(true);
      else setKillErr(`انجام نشد (خطای ${res.status}).`);
    } catch {
      setKillErr("ارتباط با سرور برقرار نشد.");
    } finally { setKilling(false); }
  }

  // مقایسه‌ی دو فیلد سمتِ کلاینت انجام می‌شود چون سرور فقط یکی را می‌گیرد؛
  // هدفش گرفتنِ غلطِ تایپی است، نه اعتبارسنجیِ امنیتی.
  const mismatch = confirm !== "" && next !== confirm;
  const ready = current !== "" && next.length >= MIN_PASSWORD && !mismatch && confirm !== "";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setPending(true);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (res.ok) { setDone(true); return; }
      const j = await res.json().catch(() => ({}));
      setErr(FA[j.error] ?? `تغییر رمز انجام نشد (خطای ${res.status}).`);
    } catch {
      setErr("ارتباط با سرور برقرار نشد.");
    } finally { setPending(false); }
  }

  if (done)
    return (
      <main className="auth-shell">
        <div className="auth-box">
          <div className="banner banner--ok" role="status">
            <Icon name="check" />
            <span>
              رمز عبور عوض شد. <strong>دستگاه‌های دیگر از حساب خارج شدند</strong> —
              اگر جایی وارد بودید باید دوباره با رمز جدید وارد شوید.
            </span>
          </div>
          <button className="primary" style={{ width: "100%" }} onClick={() => router.push("/")}>
            بازگشت به پنل
          </button>
        </div>
      </main>
    );

  return (
    <main className="auth-shell">
      <div className="auth-box">
        <h1>امنیت حساب</h1>

        <h2 style={{ marginTop: "var(--sp-4)" }}>تغییر رمز عبور</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          با تغییر رمز، همه‌ی دستگاه‌های دیگر از حساب خارج می‌شوند.
        </p>

        <form className="card" onSubmit={submit} noValidate>
          <label htmlFor="cur">رمز عبور فعلی</label>
          <input id="cur" type="password" autoComplete="current-password"
                 value={current} onChange={(e) => setCurrent(e.target.value)}
                 aria-invalid={err ? true : undefined} aria-describedby={err ? "pw-err" : undefined} required />

          <label htmlFor="new">رمز جدید</label>
          <input id="new" type="password" autoComplete="new-password"
                 value={next} onChange={(e) => setNext(e.target.value)}
                 aria-invalid={err ? true : undefined}
                 aria-describedby={err ? "pw-hint pw-err" : "pw-hint"} required />
          <div id="pw-hint" className="subtle">حداقل {MIN_PASSWORD.toLocaleString("fa-IR")} کاراکتر</div>

          <label htmlFor="rep">تکرار رمز جدید</label>
          <input id="rep" type="password" autoComplete="new-password"
                 value={confirm} onChange={(e) => setConfirm(e.target.value)}
                 aria-invalid={mismatch || undefined}
                 aria-describedby={mismatch ? "rep-mismatch" : undefined} required />
          {/* خطا کنارِ همان فیلد، نه ته فرم */}
          {mismatch && <div id="rep-mismatch" className="err"><Icon name="alert" />دو رمز یکی نیستند.</div>}

          {err && (
            <div id="pw-err" className="banner banner--error" role="alert" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
              <Icon name="alert" /><span>{err}</span>
            </div>
          )}

          <button type="submit" className="primary" disabled={pending || !ready} aria-busy={pending}
                  style={{ width: "100%", marginTop: "var(--sp-4)" }}>
            {pending && <span className="spinner" aria-hidden="true" />}
            {pending ? "در حال ثبت…" : "تغییر رمز"}
          </button>
        </form>

        <h2>خروج از همه‌ی دستگاه‌ها</h2>
        <div className="card">
          <p className="muted" style={{ marginTop: 0 }}>
            اگر فکر می‌کنید کسی به حسابتان دسترسی دارد، این را بزنید: همه‌ی
            دستگاه‌های دیگر بلافاصله بیرون می‌روند و باید دوباره با رمز وارد شوند.
            <strong> این دستگاه داخل می‌ماند.</strong>
          </p>
          {killed ? (
            <div className="banner banner--ok" role="status" style={{ marginBottom: 0 }}>
              <Icon name="check" /><span>همه‌ی دستگاه‌های دیگر خارج شدند.</span>
            </div>
          ) : (
            <>
              <button className="danger" style={{ width: "100%" }}
                      disabled={killing} aria-busy={killing} onClick={logoutAll}>
                {killing && <span className="spinner" aria-hidden="true" />}
                {killing ? "در حال انجام…" : "خروج از همه‌ی دستگاه‌های دیگر"}
              </button>
              {killErr && (
                <div className="banner banner--error" role="alert" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
                  <Icon name="alert" /><span>{killErr}</span>
                </div>
              )}
            </>
          )}
          <p className="subtle" style={{ marginBottom: 0 }}>
            اگر رمزتان لو رفته، اول <strong>رمز را عوض کنید</strong> — خروج به‌تنهایی
            جلوی کسی که رمز را دارد نمی‌گیرد.
          </p>
        </div>

        <p className="subtle" style={{ textAlign: "center" }}>
          <Link href="/">بازگشت</Link>
        </p>
      </div>
    </main>
  );
}
