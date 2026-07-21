import type { Metadata } from "next";
// وزیرمتن، **self-hosted** از node_modules — نه next/font/google و نه @import از CDN:
// هر دو در build/اجرا به گوگل fetch می‌زنند که روی VPS ایران شکننده است (تحریم/قطعی).
// این پکیج فایل‌های woff2 را همراه خودش دارد، پس build آفلاین هم کار می‌کند.
// نسخه‌ی variable است: یک فایل برای همه‌ی وزن‌ها (۳۰۰ تا ۷۰۰) به‌جای چند فایل.
import "@fontsource-variable/vazirmatn";
import "./globals.css";

export const metadata: Metadata = {
  title: "پنل موجودی و رزرو",
  description: "سامانه‌ی موجودی، رزرو و درخواست سفارش نمایندگان کاشی و سرامیک",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
