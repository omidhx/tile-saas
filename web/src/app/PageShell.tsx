"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";
import ThemeToggle from "./ThemeToggle";
import { STAFF_NAV_GROUPS, visibleNavGroups, type NavGroup } from "./NavMenu";
import type { Ctx } from "@/lib/useContexts";
import { useEscapeClose } from "@/lib/useEscapeClose";

/**
 * پوسته‌ی مشترکِ صفحاتِ داخلی — سایدبارِ چسبان (تیره، سمتِ راست چون RTL) + محتوا.
 * منطقِ فیلترِ نقش/دسترسی از NavMenu.tsx می‌آید (`visibleNavGroups`)، نه کپی —
 * همان لیست، دو نمایشِ متفاوت (dropdown قدیمی هنوز جای خودش را دارد؛ این
 * سایدبارِ دائمی است).
 *
 * صفحاتِ چاپ/ورود عمداً از این کامپوننت استفاده نمی‌کنند — سایدبار برایشان
 * معنا ندارد (چاپ: کاغذ؛ ورود: هنوز ctx نیست).
 */

// سمتِ نماینده گیتِ نقش/دسترسی ندارد (همه‌ی نماینده‌ها همین لینک‌ها را می‌بینند)،
// پس هیچ‌کدام pageKey/adminOnly/deputyOnly ندارند — visibleNavGroups همه را عبور می‌دهد.
const AGENT_NAV_GROUPS: NavGroup[] = [
  {
    title: "عملیات",
    items: [
      { href: "/reserve", label: "رزروِ جدید" },
      { href: "/reservations", label: "رزروهای من" },
      { href: "/catalogs", label: "کاتالوگ‌ها" },
    ],
  },
  { title: "حساب کاربری", items: [{ href: "/account/password", label: "امنیت حساب" }] },
];

export default function PageShell({ ctx, children }: { ctx: Ctx; children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  const isStaff = ctx.role === "admin" || ctx.role === "staff";
  const groups = visibleNavGroups(isStaff ? STAFF_NAV_GROUPS : AGENT_NAV_GROUPS, ctx);

  // با رفتن به صفحه‌ی دیگر، درِ کشویِ موبایل باید بسته شود
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  useEscapeClose(drawerOpen, () => setDrawerOpen(false));

  return (
    <div className={`app-shell${collapsed ? " app-shell--collapsed" : ""}${drawerOpen ? " app-shell--drawer-open" : ""}`}>
      <div className="app-shell__backdrop" onClick={() => setDrawerOpen(false)} />
      <aside className="app-shell__sidebar">
        <div className="app-shell__brand">
          <span className="app-shell__label">{ctx.tenantName}</span>
        </div>
        <nav className="app-shell__nav" aria-label="ناوبریِ اصلی">
          {groups.map((g) => (
            <div className="app-shell__group" key={g.title}>
              <div className="app-shell__group-title">{g.title}</div>
              {g.items.map((it) => (
                <Link
                  key={it.href} href={it.href} className="app-shell__link"
                  aria-current={pathname === it.href ? "page" : undefined}
                >
                  <span className="app-shell__label">{it.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="app-shell__footer">
          <button
            type="button" className="sidebar-btn" onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? "بازکردنِ سایدبار" : "جمع‌کردنِ سایدبار"}
          >
            <Icon name={collapsed ? "chevron-left" : "chevron-right"} size={16} />
          </button>
          <ThemeToggle />
        </div>
      </aside>

      <div className="app-shell__main">
        <div className="app-shell__header no-print">
          <button
            type="button" className="header-btn header-btn--drawer" onClick={() => setDrawerOpen(true)}
            aria-label="بازکردنِ منو"
          >
            <Icon name="menu" size={18} />
          </button>
        </div>
        {/* نه <main>: هر صفحه‌ی داخلِ PageShell خودش یک <main> دارد (main/main.wide
            در globals.css) — دوتا <main> تودرتو هم HTML نامعتبر بود هم لندمارکِ
            دوبل برای صفحه‌خوان. این فقط کشیدنِ عرض/فلکس است. */}
        <div className="app-shell__content">{children}</div>
      </div>
    </div>
  );
}
