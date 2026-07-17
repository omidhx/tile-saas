"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
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
        body: JSON.stringify({ phone, password }),
      });
      if (res.ok) router.push("/reserve");
      else {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? "خطا در ورود");
      }
    } catch {
      setErr("ارتباط با سرور برقرار نشد");
    } finally {
      setPending(false);
    }
  }

  return (
    <main>
      <h1>ورود نماینده</h1>
      <form className="card" onSubmit={submit}>
        <label htmlFor="phone">شماره موبایل</label>
        <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)}
               inputMode="numeric" autoComplete="username" required />
        <label htmlFor="pw">رمز عبور</label>
        <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
               autoComplete="current-password" required />
        <div style={{ marginTop: "1rem" }}>
          <button type="submit" disabled={pending}>
            {pending && <span className="spinner" />}
            {pending ? "در حال ورود…" : "ورود"}
          </button>
        </div>
        {err && <div className="err">{err}</div>}
      </form>
    </main>
  );
}
