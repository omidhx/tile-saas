import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
// وزیرمتن، **self-hosted** از node_modules — نه next/font/google و نه @import از CDN:
// هر دو در build/اجرا به گوگل fetch می‌زنند که روی VPS ایران شکننده است (تحریم/قطعی).
// این پکیج فایل‌های woff2 را همراه خودش دارد، پس build آفلاین هم کار می‌کند.
// نسخه‌ی variable است: یک فایل برای همه‌ی وزن‌ها (۳۰۰ تا ۷۰۰) به‌جای چند فایل.
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import PwaRegister from "./PwaRegister";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "پنل موجودی و رزرو",
  description: "سامانه‌ی موجودی، رزرو و درخواست سفارش نمایندگان کاشی و سرامیک",
  manifest: "/manifest.json",
};

// کاتالوگِ عمومی تنها بخشی است که PWA سبک برایش معنا دارد (کشِ فقط‌خواندنی)؛
// رزرو همیشه آنلاین است (spec ۶) — نصبِ اپ صرفاً یک میان‌بُر/دسترسیِ آفلاینِ
// کاتالوگ است، نه یک اپِ مستقل با منطقِ خودش.
export const viewport: Viewport = { themeColor: "#0f172a" };

// THEME_INIT_SCRIPT در lib/theme.ts است؛ UI تازه (`(app)/layout.tsx`) همان را می‌خواند.

// suppressHydrationWarning: THEME_INIT_SCRIPT بالا data-theme را قبل از هیدریتِ React
// روی <html> می‌نشاند — سرور از localStorage خبر ندارد، پس این تفاوت همیشگی و
// بی‌خطر است؛ بدونِ این پرچم React هر بار در کنسول هشدارِ mismatch می‌داد.
// nonceِ CSP از middleware می‌آید (هدرِ x-nonce، یک‌بارمصرف در هر request) — بدونش
// این <script> با script-src 'nonce-…' مسدود می‌شد. خواندنش از headers() یعنی
// RootLayout دیگر نمی‌تواند static باشد؛ برای این اپ (کاملاً دینامیک، پشتِ session) مشکلی نیست.
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>
        {/* suppressHydrationWarning روی خودِ <script>: مرورگرها بعدِ اجرا مقدارِ
            nonce را از DOM پاک می‌کنند (ضدِ خواندنش توسطِ اسکریپتِ دیگر) — یعنی
            hydrationِ React همیشه nonceِ سرور را در برابرِ "" در کلاینت می‌بیند.
            این یک mismatchِ امنیتیِ عمدیِ خودِ مرورگر است، نه باگِ این کد. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
