import type { Metadata, Viewport } from "next";
// وزیرمتن، **self-hosted** از node_modules — نه next/font/google و نه @import از CDN:
// هر دو در build/اجرا به گوگل fetch می‌زنند که روی VPS ایران شکننده است (تحریم/قطعی).
// این پکیج فایل‌های woff2 را همراه خودش دارد، پس build آفلاین هم کار می‌کند.
// نسخه‌ی variable است: یک فایل برای همه‌ی وزن‌ها (۳۰۰ تا ۷۰۰) به‌جای چند فایل.
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import PwaRegister from "./PwaRegister";

export const metadata: Metadata = {
  title: "پنل موجودی و رزرو",
  description: "سامانه‌ی موجودی، رزرو و درخواست سفارش نمایندگان کاشی و سرامیک",
  manifest: "/manifest.json",
};

// کاتالوگِ عمومی تنها بخشی است که PWA سبک برایش معنا دارد (کشِ فقط‌خواندنی)؛
// رزرو همیشه آنلاین است (spec ۶) — نصبِ اپ صرفاً یک میان‌بُر/دسترسیِ آفلاینِ
// کاتالوگ است، نه یک اپِ مستقل با منطقِ خودش.
export const viewport: Viewport = { themeColor: "#0f172a" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
