"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";
import type { Ctx } from "@/lib/useContexts";
import { hasPageAccess } from "@/lib/staffPages";
import { useEscapeClose } from "@/lib/useEscapeClose";

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
 *
 * v4: لینکِ صفحه‌ای که کاربر بهش دسترسی ندارد اصلاً نشان داده نمی‌شود — قبلاً
 * همه‌چیز به همه نشان داده می‌شد و کلیک روی صفحه‌ی ممنوعه بنرِ خطا می‌گرفت؛ آن
 * تجربه گمراه‌کننده بود («این لینک هست ولی کار نمی‌کند»). حالا NavMenu نقش/
 * دسترسیِ کاربر را از ctx می‌گیرد و فیلتر می‌کند.
 */

export type NavItem = {
  href: string; label: string;
  // نبودِ هر سه یعنی همیشه نشان داده شود (مثلِ «امنیت حساب»)
  pageKey?: string;      // یکی از STAFF_PAGE_KEYS — برای role='staff' چک می‌شود
  adminOnly?: boolean;   // فقط role==='admin'
  deputyOnly?: boolean;  // فقط role==='admin' && canManageAccess
};
export type NavGroup = { title: string; items: NavItem[] };

/** گروه‌های ناوبریِ پشتیبان — هم NavMenu (dropdown) هم PageShell (sidebar) از همین یک منبع می‌خوانند. */
export const STAFF_NAV_GROUPS: NavGroup[] = [
  {
    // v7: قیمت‌گذاری/موجودیِ در راه/جایگزین‌ها دیگر تبِ خودشان را ندارند — روی
    // کارتِ همان محصول در «محصولات» باز می‌شوند (pageKeyِ هرکدام همان‌جا، روی
    // دکمه‌اش، چک می‌شود). فقط «ورود از اکسل» چون عملیاتی دسته‌جمعی‌ست تبِ جداست.
    title: "محصول و موجودی",
    items: [
      { href: "/staff/catalog", label: "محصولات", pageKey: "catalog" },
      { href: "/staff/catalog?tab=import", label: "ورود از اکسل", pageKey: "import" },
    ],
  },
  {
    // v6: گزارش‌ها/دفترِ حرکات/دفترِ تغییرات هم همین‌طور زیرِ یک صفحه‌ی تب‌دارند.
    title: "گزارش و ردیابی",
    items: [
      { href: "/staff/reports", label: "گزارش‌ها", pageKey: "reports" },
      { href: "/staff/reports?tab=ledger", label: "دفتر حرکات موجودی", pageKey: "ledger" },
      { href: "/staff/reports?tab=audit", label: "دفتر تغییرات", pageKey: "audit" },
    ],
  },
  {
    // v8: تیم/نمایندگی‌ها/انبارها/تأییدِ خودکار زیرِ یک هابِ تب‌دار (/staff/team)اند —
    // این لینک‌ها فقط میان‌بُرِ «همان صفحه، همان تب»اند، هرکدام با گیتِ خودشان.
    title: "راه‌اندازی و دسترسی",
    items: [
      { href: "/staff/customers", label: "مشتریان", pageKey: "customers" },
      { href: "/staff/team", label: "تیمِ کارخانه", deputyOnly: true },
      { href: "/staff/team?tab=agents", label: "نمایندگی‌ها", adminOnly: true },
      { href: "/staff/team?tab=warehouses", label: "انبارها", adminOnly: true },
      { href: "/staff/team?tab=auto-approve", label: "تأیید خودکار", pageKey: "auto-approve" },
      { href: "/staff/team?tab=settings", label: "تنظیماتِ کارخانه", adminOnly: true },
    ],
  },
  {
    title: "حساب کاربری",
    items: [{ href: "/account/password", label: "امنیت حساب" }],
  },
];

function visible(item: NavItem, ctx: Ctx): boolean {
  if (item.deputyOnly) return ctx.role === "admin" && ctx.canManageAccess;
  if (item.adminOnly) return ctx.role === "admin";
  if (item.pageKey) return ctx.role === "admin" || hasPageAccess(ctx.allowedPages, item.pageKey);
  return true;
}

/** فیلترِ نقش/دسترسی، یک‌بار — NavMenu (dropdown) و PageShell (sidebar) هردو همین را صدا می‌زنند. */
export function visibleNavGroups(groups: NavGroup[], ctx: Ctx): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => visible(it, ctx)) }))
    .filter((g) => g.items.length > 0);
}

export default function NavMenu({ ctx }: { ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  const groups = visibleNavGroups(STAFF_NAV_GROUPS, ctx);

  // با رفتن به صفحه‌ی دیگر، منو باید بسته شود — وگرنه روی صفحه‌ی جدید باز می‌ماند
  useEffect(() => { setOpen(false); }, [pathname]);

  // فوکوس برمی‌گردد به دکمه، نه به ابتدای صفحه
  useEscapeClose(open, () => { setOpen(false); buttonRef.current?.focus(); });

  useEffect(() => {
    if (!open) return;

    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !buttonRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    // اولین لینک فوکوس می‌گیرد تا کاربرِ کیبورد لازم نباشد کورکورانه Tab بزند
    panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();

    return () => document.removeEventListener("mousedown", onClick);
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
          {groups.map((g) => (
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
