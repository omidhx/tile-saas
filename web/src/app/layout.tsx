import type { Metadata } from "next";
import "./globals.css";

// بدون next/font/google: fetch از گوگل در build روی VPS ایران شکننده‌ست (تحریم/قطعی).
// فونت سیستمی کافیه. UI فارسی و RTL.
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
