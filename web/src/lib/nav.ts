import type { Ctx } from "@/lib/useContexts";

/**
 * منوی پنل پشتیبان، گروه‌بندی‌شده مثل طلاسرام (عملیات، محصولات، فروش، گزارش‌ها، تنظیمات). هر دو پوسته
 * (PageShell قدیم و AppShell تازه) از همین می‌خوانند؛ `icon` نام آیکن lucide است و فقط پوسته‌ی تازه آن را نشان می‌دهد.
 * لینکِ صفحه‌ای که کاربر بهش دسترسی ندارد اصلاً نشان داده نمی‌شود. صفحه‌های انبار در فاز ۷ آمدند؛ حواله‌ی کامل فاز ۹.
 */
export type NavItem = { href: string; label: string; icon?: string; adminOnly?: boolean };
export type NavGroup = { title: string; items: NavItem[] };

export const STAFF_NAV_GROUPS: NavGroup[] = [
  { title: "عملیات", items: [{ href: "/staff", label: "کارتابل", icon: "inbox" }] },
  {
    title: "انبار",
    items: [
      { href: "/warehouse/goods-in", label: "ورود کالا", icon: "packagePlus" },
      { href: "/warehouse", label: "لیست کالاهای انبار", icon: "boxes" },
      { href: "/warehouse/stock", label: "جمع موجودی", icon: "layers" },
    ],
  },
  {
    title: "محصولات",
    items: [
      { href: "/staff/catalog", label: "محصولات و موجودی", icon: "package" },
      { href: "/staff/catalog?tab=import", label: "ورود از اکسل", icon: "sheet" },
    ],
  },
  { title: "فروش", items: [{ href: "/staff/customers", label: "مشتریان", icon: "users" }] },
  {
    title: "گزارش‌ها",
    items: [
      { href: "/staff/reports", label: "گزارش‌ها", icon: "chart" },
      { href: "/staff/reports?tab=ledger", label: "لاگ", icon: "history" },
    ],
  },
  {
    title: "تنظیمات",
    items: [
      { href: "/staff/team", label: "تیم کارخانه", icon: "team", adminOnly: true },
      { href: "/staff/team?tab=agents", label: "نمایندگی‌ها", icon: "store", adminOnly: true },
      { href: "/staff/team?tab=warehouses", label: "انبارها", icon: "warehouse", adminOnly: true },
      { href: "/staff/team?tab=settings", label: "تنظیمات و امکانات", icon: "settings", adminOnly: true },
      { href: "/account/password", label: "امنیت حساب", icon: "shield" },
    ],
  },
];

export function visibleNavGroups(groups: NavGroup[], ctx: Ctx): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((it) => !it.adminOnly || ctx.role === "admin") }))
    .filter((g) => g.items.length > 0);
}
