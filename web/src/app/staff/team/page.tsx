"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import PageShell from "../../PageShell";
import { TabBar } from "../Tabs";
import { hasPageAccess } from "@/lib/staffPages";
import { useContexts, type Ctx } from "@/lib/useContexts";
import TeamSection from "./TeamSection";
import AgentsSection from "./AgentsSection";
import WarehousesSection from "./WarehousesSection";
import AutoApproveSection from "./AutoApproveSection";
import SettingsSection from "./SettingsSection";
import SmsSection from "./SmsSection";

/**
 * v8: تیم/نمایندگی‌ها/انبارها/تأییدِ خودکار زیرِ یک هابِ تب‌دار — همه‌شان صفحاتِ
 * راه‌اندازی/مدیریتی‌اند که به‌ندرت (نه هر روز) باز می‌شوند، پس سوییچِ بینِ آدرس‌ها
 * برایشان بیشتر از کاتالوگ/گزارش‌ها آزاردهنده نبود، ولی همان منطق صدق می‌کند.
 *
 * گیتِ هر تب با گیتِ همان صفحه‌ی قدیم یکی مانده — عمداً مشترک نشده، چون این سه
 * قانونِ متفاوت دارند: تیم فقط برای «مدیرِ دسترسی»، نمایندگی‌ها/انبارها/تنظیمات فقط
 * برای admin، و تأییدِ خودکار با همان pageKey ریزدانه‌ی قبلی (`allowed_pages`).
 */
type TabKey = "team" | "agents" | "warehouses" | "auto-approve" | "settings";
const ALL_TABS: { key: TabKey; label: string; visible: (ctx: Ctx) => boolean }[] = [
  { key: "team", label: "تیمِ کارخانه", visible: (ctx) => ctx.role === "admin" && ctx.canManageAccess },
  { key: "agents", label: "نمایندگی‌ها", visible: (ctx) => ctx.role === "admin" },
  { key: "warehouses", label: "انبارها", visible: (ctx) => ctx.role === "admin" },
  { key: "auto-approve", label: "تأیید خودکار", visible: (ctx) => ctx.role === "admin" || hasPageAccess(ctx.allowedPages, "auto-approve") },
  { key: "settings", label: "تنظیماتِ کارخانه", visible: (ctx) => ctx.role === "admin" },
];

export default function SetupHubPage() {
  const { ctx, state } = useContexts("staff");
  const [tab, setTab] = useState<TabKey>("team");

  // آدرسِ ورودی (مثلاً از سایدبار یا لینکِ قدیمی: ?tab=agents) تبِ اولیه را تعیین می‌کند —
  // فقط در کلاینت خوانده می‌شود تا با رندرِ اول (که همیشه «team» است) ناسازگار نشود.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && ALL_TABS.some((x) => x.key === t)) setTab(t as TabKey);
  }, []);
  function go(key: string) {
    setTab(key as TabKey);
    history.replaceState(null, "", `?tab=${key}`);
  }

  if (state === "none")
    return <main><div className="banner banner--error" role="alert"><Icon name="alert" /><span>این بخش فقط برای پشتیبان است.</span></div></main>;
  if (!ctx) return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;

  const tabs = ALL_TABS.filter((t) => t.visible(ctx));
  if (tabs.length === 0)
    return <PageShell ctx={ctx}><main><div className="banner banner--error" role="alert"><Icon name="alert" /><span>دسترسیِ این بخش برایت باز نیست.</span></div></main></PageShell>;
  const activeTab = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  return (
    <PageShell ctx={ctx}>
    <main>
      <div className="topbar">
        <div>
          <h1>راه‌اندازی</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link></nav>
      </div>

      <TabBar tabs={tabs} active={activeTab} onChange={go} />

      {activeTab === "team" && <TeamSection ctx={ctx} />}
      {activeTab === "agents" && <AgentsSection ctx={ctx} />}
      {activeTab === "warehouses" && <WarehousesSection ctx={ctx} />}
      {activeTab === "auto-approve" && <AutoApproveSection ctx={ctx} />}
      {activeTab === "settings" && <><SettingsSection ctx={ctx} /><SmsSection ctx={ctx} /></>}
    </main>
    </PageShell>
  );
}
