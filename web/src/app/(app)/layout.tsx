import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
// وزیرمتن self-hosted از node_modules؛ همان دلیل layout قدیمی (build آفلاین، بدون fetch به گوگل).
import "@fontsource-variable/vazirmatn";
import "./app.css";
import { DirectionProvider } from "@/components/ui/direction";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/**
 * root layout دوم: صفحه‌های بازطراحی‌شده (Tailwind + shadcn/ui). صفحه‌های `(legacy)` layout و
 * globals.css خودشان را دارند، چون استایل‌های عنصری آن (button، input، h1) به کامپوننت‌های تازه
 * نشت می‌کرد. رفتن بین این دو گروه یک بارگذاری کامل صفحه است (رفتار Next با چند root layout).
 */
export const metadata: Metadata = {
  title: "پنل موجودی و رزرو",
  description: "سامانه‌ی موجودی، رزرو و درخواست سفارش نمایندگان کاشی و سرامیک",
};

export const viewport: Viewport = { themeColor: "#0f172a" };

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    // suppressHydrationWarning: اسکریپت تم data-theme را قبل از hydrate می‌نشاند و مرورگر nonce را از DOM پاک می‌کند.
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Radix جهت را از DOM نمی‌خواند؛ بدون این، کلیدهای جهت در Tabs برعکس کار می‌کنند. */}
        <DirectionProvider dir="rtl">{children}</DirectionProvider>
      </body>
    </html>
  );
}
