"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOutIcon, MenuIcon, MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { STAFF_NAV_GROUPS, visibleNavGroups, type NavGroup } from "@/lib/nav";
import { THEME_KEY } from "@/lib/theme";
import type { Ctx } from "@/lib/useContexts";
import { cn } from "@/lib/utils";

/**
 * پوسته‌ی صفحه‌های تازه‌ی staff. دسکتاپ: سایدبار تیره‌ی ثابت در سمت راست. موبایل: نوار بالا و منوی کشویی.
 * فهرست منو از lib/nav.ts می‌آید، همان که پوسته‌ی قدیمی می‌خواند؛ لینک به صفحه‌ی قدیمی
 * یک بارگذاری کامل است چون root layout دیگری دارد.
 */
export function AppShell({ ctx, children }: { ctx: Ctx; children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const groups = visibleNavGroups(STAFF_NAV_GROUPS, ctx);

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col bg-sidebar text-sidebar-foreground md:flex no-print">
        <Brand name={ctx.tenantName} />
        <Nav groups={groups} pathname={pathname} className="flex-1 overflow-y-auto" />
        <div className="flex items-center gap-1 border-t border-white/10 p-2">
          <ThemeToggle className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" />
          <LogoutButton className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground" />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card px-3 md:hidden no-print">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="باز کردن منو"><MenuIcon /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-sidebar p-0 text-sidebar-foreground">
              <SheetHeader className="p-0">
                <SheetTitle className="sr-only">منو</SheetTitle>
                <Brand name={ctx.tenantName} />
              </SheetHeader>
              <Nav groups={groups} pathname={pathname} onNavigate={() => setMenuOpen(false)} />
            </SheetContent>
          </Sheet>
          <span className="truncate text-sm font-semibold">{ctx.tenantName}</span>
          <span className="ms-auto flex items-center">
            <ThemeToggle />
            <LogoutButton />
          </span>
        </header>
        <main className="mx-auto w-full max-w-6xl p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

function Brand({ name }: { name: string }) {
  return (
    <div className="flex h-14 items-center gap-2.5 border-b border-white/10 px-4">
      <span aria-hidden="true" className="grid size-8 place-items-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar">
        {name.trim().charAt(0)}
      </span>
      <span className="truncate text-sm font-semibold">{name}</span>
    </div>
  );
}

function Nav({
  groups, pathname, onNavigate, className,
}: { groups: NavGroup[]; pathname: string; onNavigate?: () => void; className?: string }) {
  return (
    <nav aria-label="ناوبری اصلی" className={cn("grid content-start gap-4 p-3", className)}>
      {groups.map((g) => (
        <div key={g.title} className="grid gap-0.5">
          <div className="px-2 pb-1 text-xs text-sidebar-muted">{g.title}</div>
          {g.items.map((it) => {
            const active = it.href === pathname;
            return (
              <Link
                key={it.href} href={it.href} onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2 py-1.5 text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-primary pointer-coarse:py-2.5",
                  active && "bg-sidebar-accent font-semibold text-sidebar-primary",
                )}
              >
                {it.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function ThemeToggle({ className }: { className?: string }) {
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
    <Button variant="ghost" size="icon" className={className} onClick={toggle} aria-pressed={dark}
      aria-label="تم تیره" title="تم تیره">
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}

function LogoutButton({ className }: { className?: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <Button variant="ghost" size="sm" className={className} pending={pending}
      title={failed ? "خروج انجام نشد؛ دوباره بزنید" : undefined}
      onClick={async () => {
        setPending(true);
        // فقط وقتی نشست واقعاً بسته شد برو؛ روی رایانه‌ی مشترک، رفتن با خطا یعنی نشست باز می‌ماند
        const r = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
        if (r?.ok) window.location.assign("/login");
        else { setPending(false); setFailed(true); }
      }}>
      {!pending && <LogOutIcon />}{failed ? "خروج نشد، دوباره" : "خروج"}
    </Button>
  );
}
