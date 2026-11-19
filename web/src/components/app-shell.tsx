"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BoxesIcon, ChartColumnIcon, FileSpreadsheetIcon, HistoryIcon, LayersIcon, PackagePlusIcon, InboxIcon, LayoutGridIcon, LogOutIcon, MenuIcon, MoonIcon,
  PackageIcon, SettingsIcon, ShieldCheckIcon, StoreIcon, SunIcon, UserCogIcon, UsersIcon, WarehouseIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { STAFF_NAV_GROUPS, visibleNavGroups, type NavGroup } from "@/lib/nav";
import { THEME_KEY } from "@/lib/theme";
import type { Ctx } from "@/lib/useContexts";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  inbox: InboxIcon, package: PackageIcon, sheet: FileSpreadsheetIcon, users: UsersIcon, chart: ChartColumnIcon,
  history: HistoryIcon, packagePlus: PackagePlusIcon, boxes: BoxesIcon, layers: LayersIcon, team: UserCogIcon, store: StoreIcon, warehouse: WarehouseIcon, settings: SettingsIcon, shield: ShieldCheckIcon,
};
const ROLE_FA: Record<string, string> = { admin: "مدیر کارخانه", staff: "کارمند فروش" };

/**
 * پوسته‌ی صفحه‌های تازه‌ی staff. دسکتاپ: سایدبار روشن با آیکن در سمت راست و نوار بالا با عنوان و کارهای همان صفحه.
 * موبایل: نوار بالا و منوی کشویی. منو از lib/nav.ts می‌آید؛ لینک به صفحه‌ی قدیمی بارگذاری کامل است (root layout دیگر).
 */
export function AppShell({
  ctx, title, subtitle, actions, children,
}: { ctx: Ctx; title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const groups = visibleNavGroups(STAFF_NAV_GROUPS, ctx);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      {/* aside با برچسب: صفحه هم ستون کناری خودش را دارد و دو لندمارک هم‌نوع باید نام جدا داشته باشند (axe) */}
      <aside data-sidebar aria-label="منوی کناری" className="sticky top-0 hidden h-dvh flex-col border-e bg-sidebar text-sidebar-foreground md:flex no-print">
        <Brand name={ctx.tenantName} />
        <Nav groups={groups} pathname={pathname} className="flex-1 overflow-y-auto" />
        <UserFooter ctx={ctx} />
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex min-h-16 items-center gap-3 border-b bg-card/95 px-3 py-2 backdrop-blur md:px-6 no-print">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" className="md:hidden" aria-label="باز کردن منو"><MenuIcon /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 gap-0 bg-sidebar p-0 text-sidebar-foreground">
              <SheetHeader className="p-0">
                <SheetTitle className="sr-only">منو</SheetTitle>
                <Brand name={ctx.tenantName} />
              </SheetHeader>
              <Nav groups={groups} pathname={pathname} onNavigate={() => setMenuOpen(false)} className="flex-1 overflow-y-auto" />
              <UserFooter ctx={ctx} />
            </SheetContent>
          </Sheet>
          <div className="min-w-0 leading-tight">
            <h1 className="truncate text-lg font-bold">{title}</h1>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="ms-auto flex items-center gap-2">
            {actions}
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

function Brand({ name }: { name: string }) {
  return (
    <div className="flex h-16 shrink-0 items-center gap-2.5 px-4">
      <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-teal-600 to-teal-800 text-white shadow-sm">
        <LayoutGridIcon className="size-5" />
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-sm font-bold">{name}</div>
        <div className="text-[11px] text-sidebar-muted">پنل فروش و انبار</div>
      </div>
    </div>
  );
}

function Nav({
  groups, pathname, onNavigate, className,
}: { groups: NavGroup[]; pathname: string; onNavigate?: () => void; className?: string }) {
  return (
    <nav aria-label="ناوبری اصلی" className={cn("grid content-start gap-4 px-3 py-2", className)}>
      {groups.map((g) => (
        <div key={g.title} className="grid gap-0.5">
          <div className="px-2.5 pb-1 text-[11px] font-medium text-sidebar-muted">{g.title}</div>
          {g.items.map((it) => {
            const active = it.href === pathname;
            const Icon = it.icon ? ICONS[it.icon] : undefined;
            return (
              <Link
                key={it.href} href={it.href} onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-11",
                  active && "bg-sidebar-accent font-semibold text-sidebar-primary",
                )}
              >
                {Icon && <Icon className={cn("size-4", active ? "text-sidebar-primary" : "text-sidebar-muted")} aria-hidden="true" />}
                {it.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function UserFooter({ ctx }: { ctx: Ctx }) {
  return (
    <div className="flex shrink-0 items-center gap-2.5 border-t p-3">
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-sidebar-accent text-xs font-bold text-sidebar-primary">
        {ctx.tenantName.trim().charAt(0)}
      </span>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13px] font-semibold">{ROLE_FA[ctx.role] ?? ctx.role}</div>
        <div className="truncate text-[11px] text-sidebar-muted">{ctx.tenantName}</div>
      </div>
      <LogoutButton />
    </div>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  // مقدار اولیه از DOM، همان چیزی که اسکریپت no-flash نوشته؛ بدون انتخاب، تم سیستم.
  useEffect(() => {
    const t = document.documentElement.getAttribute("data-theme");
    setDark(t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  function toggle() {
    const next = dark ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* حالت خصوصی مرورگر */ }
    setDark(!dark);
  }
  return (
    <Button variant="outline" size="icon" onClick={toggle} aria-pressed={dark} aria-label="تم تیره" title="تم تیره">
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Button variant="ghost" size="icon" className="ms-auto text-sidebar-muted" pending={pending}
      aria-label={failed ? "خروج انجام نشد؛ دوباره بزنید" : "خروج"} title={failed ? "خروج انجام نشد؛ دوباره بزنید" : "خروج"}
      onClick={async () => {
        setPending(true);
        // فقط وقتی نشست واقعاً بسته شد برو؛ روی رایانه‌ی مشترک، رفتن با خطا یعنی نشست باز می‌ماند
        const r = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
        if (r?.ok) window.location.assign("/login");
        else { setPending(false); setFailed(true); }
      }}>
      {!pending && <LogOutIcon className={failed ? "text-destructive" : undefined} />}
    </Button>
  );
}
