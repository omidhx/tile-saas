"use client";

/**
 * نوارِ تب برای صفحاتِ ادغام‌شده (مثلاً «محصول و موجودی» یا «گزارش‌ها») — چند
 * صفحه‌ی قبلاً جدا حالا زیرِ یک مسیر، تا پشتیبان مجبور نباشد مدام بینِ آدرس‌ها
 * سوییچ کند. وقتی فقط یک تب قابلِ‌دیدن است (دسترسیِ محدود)، نوار اصلاً نشان
 * داده نمی‌شود — نه تبِ تنها.
 */
export type Tab = { key: string; label: string };

export function TabBar({ tabs, active, onChange }: { tabs: Tab[]; active: string; onChange: (key: string) => void }) {
  if (tabs.length <= 1) return null;
  return (
    <div className="row row--start" role="tablist" style={{ gap: "var(--sp-2)", flexWrap: "wrap", marginBottom: "var(--sp-3)" }}>
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={active === t.key}
          className={active === t.key ? "primary" : "ghost"} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
