"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";

/**
 * منوی ناوبریِ پنل پشتیبان.
 *
 * چرا منو و نه نوارِ تخت: ده لینک در یک نوار، روی موبایل می‌پیچد و روی دسکتاپ هم
 * نویز است. ولی نکته‌ی اصلی **گروه‌بندی** است نه پنهان‌کردن — همبرگر با ده لینکِ
 * تختِ داخلش فقط شلوغی را یک کلیک عقب می‌برد.
 *
 * گروه‌بندی بر اساس **بسامدِ استفاده** است، نه حروف الفبا:
 *   • «کارِ روزمره» چیزی است که پشتیبان هفتگی باز می‌کند
 *   • «تنظیمات» یک‌بار در راه‌اندازی تنظیم می‌شود و بعد دست‌نخورده می‌ماند
 *   • «گزارش و ردیابی» فقط وقتی سؤال یا مشکلی پیش بیاید
 * کاربر اینطور می‌داند کجا را بگردد، حتی وقتی نامِ دقیقِ صفحه یادش نیست.
 */

type Item = { href: string; label: string };
type Group = { title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    title: "کار روزمره",
    items: [
      { href: "/staff/import", label: "ورود موجودی از اکسل" },
      { href: "/staff/incoming", label: "موجودی در راه" },
      { href: "/staff/customers", label: "مشتریان" },
    ],
  },
  {
    title: "تنظیمات فروش",
    items: [
      { href: "/staff/prices", label: "قیمت‌گذاری" },
      { href: "/staff/auto-approve", label: "تأیید خودکار" },
      { href: "/staff/substitutes", label: "کالای جایگزین" },
      { href: "/staff/catalog", label: "کاتالوگ تصویری" },
    ],
  },
  {
    title: "گزارش و ردیابی",
    items: [
      { href: "/staff/reports", label: "گزارش‌های مدیریتی" },
      { href: "/staff/ledger", label: "دفتر حرکات موجودی" },
      { href: "/staff/audit", label: "دفتر تغییرات" },
    ],
  },
  {
    title: "حساب کاربری",
    items: [{ href: "/account/password", label: "امنیت حساب" }],
  },
];

export default function NavMenu() {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  // با رفتن به صفحه‌ی دیگر، منو باید بسته شود — وگرنه روی صفحه‌ی جدید باز می‌ماند
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus(); // فوکوس برمی‌گردد به دکمه، نه به ابتدای صفحه
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    // اولین لینک فوکوس می‌گیرد تا کاربرِ کیبورد لازم نباشد کورکورانه Tab بزند
    panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div className="navmenu">
      <button
        ref={buttonRef}
        className="ghost navmenu__button"
        aria-expanded={open}
        aria-controls="nav-panel"
        // آیکن تنهاست، پس اسم باید برای صفحه‌خوان صریح باشد
        aria-label={open ? "بستن منو" : "باز کردن منو"}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={open ? "close" : "menu"} size={20} />
        <span className="navmenu__label">منو</span>
      </button>

      {open && (
        <div id="nav-panel" ref={panelRef} className="navmenu__panel" role="navigation" aria-label="منوی پنل">
          {GROUPS.map((g) => (
            <div key={g.title} className="navmenu__group">
              <div className="navmenu__title">{g.title}</div>
              {g.items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className="navmenu__item"
                  // صفحه‌ی فعلی هم برای چشم علامت دارد هم برای صفحه‌خوان
                  aria-current={pathname === it.href ? "page" : undefined}
                >
                  {it.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
