"use client";
import Icon from "./Icon";

/**
 * مرزِ خطای App Router — بدونِ این، یک throw ناگهانی در رندر صفحه‌ی خامِ
 * پیش‌فرضِ Next را نشان می‌دهد (بدون RTL، بدون فارسی، بدون راهِ بازگشت).
 */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ maxWidth: 480, textAlign: "center" }}>
      <div className="banner banner--error" role="alert" style={{ marginTop: "var(--sp-6)" }}>
        <Icon name="alert" />
        <span>یک خطای غیرمنتظره رخ داد.</span>
      </div>
      <div style={{ display: "flex", gap: "var(--sp-2)", justifyContent: "center", marginTop: "var(--sp-4)" }}>
        <button className="primary" onClick={reset}>تلاشِ دوباره</button>
        <button className="ghost" onClick={() => { window.location.href = "/staff"; }}>بازگشت به پنل</button>
      </div>
    </main>
  );
}
