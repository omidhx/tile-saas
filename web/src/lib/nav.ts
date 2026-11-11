import type { Ctx } from "@/lib/useContexts";

/**
 * منوی پنل پشتیبان، گروه‌بندی‌شده بر اساسِ بسامدِ استفاده. هر دو پوسته (PageShell قدیم و AppShell تازه) از همین می‌خوانند.
 * لینکِ صفحه‌ای که کاربر بهش دسترسی ندارد اصلاً نشان داده نمی‌شود.
 */
export type NavItem = { href: string; label: string; adminOnly?: boolean };
export type NavGroup = { title: string; items: NavItem[] };

export const STAFF_NAV_GROUPS: NavGroup[] = [
  { title: "کار روزانه", items: [{ href: "/staff", label: "کارتابل" }] },
  {
    title: "محصول و موجودی",
    items: [
      { href: "/staff/catalog", label: "محصولات" },
      { href: "/staff/catalog?tab=import", label: "ورود از اکسل" },
    ],
  },
  {
    title: "گزارش و ردیابی",
    items: [
      { href: "/staff/reports", label: "گزارش‌ها" },
      { href: "/staff/reports?tab=ledger", label: "لاگ" },
    ],
  },
  {
    title: "راه‌اندازی و دسترسی",
    items: [
      { href: "/staff/customers", label: "مشتریان" },
      { href: "/staff/team", label: "تیمِ کارخانه", adminOnly: true },
      { href: "/staff/team?tab=agents", label: "نمایندگی‌ها", adminOnly: true },
      { href: "/staff/team?tab=warehouses", label: "انبارها", adminOnly: true },
      { href: "/staff/team?tab=settings", label: "تنظیمات و امکانات", adminOnly: true },
    ],
  },
  {
    title: "حساب کاربری",
    items: [{ href: "/account/password", label: "امنیت حساب" }],
  },
];

export function visibleNavGroups(groups: NavGroup[], ctx: Ctx): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => !it.adminOnly || ctx.role === "admin") }))
    .filter((g) => g.items.length > 0);
}
