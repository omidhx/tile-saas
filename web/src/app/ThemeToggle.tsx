"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";

/**
 * تاگلِ دستیِ روشن/تیره — قبل از این کامپوننت، تم فقط از prefers-color-scheme
 * می‌آمد (بدونِ کنترلِ کاربر). مقدار روی `data-theme` در <html> و در
 * localStorage می‌نشیند؛ اسکریپتِ no-flash در layout.tsx همین کلید را قبل از
 * paintِ اول می‌خواند تا رفرش، فلشِ تمِ غلط نسازد.
 */
const KEY = "tile.theme";

function apply(theme: "light" | "dark") {
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(KEY, theme); } catch { /* حالتِ خصوصیِ مرورگر — فقط تا پایانِ همین صفحه می‌ماند */ }
}

export default function ThemeToggle({ className }: { className?: string }) {
  // مقدارِ اولیه از خودِ DOM خوانده می‌شود (همان چیزی که اسکریپتِ no-flash نوشته)،
  // نه از localStorage مستقیم — تا با رفتاری که کاربر همین حالا می‌بیند یکی باشد.
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "dark") setTheme("dark");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    apply(next);
    setTheme(next);
  }

  return (
    <button
      type="button"
      className={`sidebar-btn ${className ?? ""}`}
      onClick={toggle}
      aria-pressed={theme === "dark"}
      aria-label={theme === "dark" ? "رفتن به تمِ روشن" : "رفتن به تمِ تیره"}
      title={theme === "dark" ? "تمِ روشن" : "تمِ تیره"}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
    </button>
  );
}
