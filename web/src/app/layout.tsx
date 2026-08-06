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

// no-flash: قبل از رنگ‌آمیزیِ اول، data-theme را از localStorage روی <html> می‌نشاند —
// بدونِ این، صفحه یک لحظه با تمِ پیش‌فرض (روشن) نقاشی می‌شد و بعد به تیره می‌پرید.
// اسکریپتِ Server Component معمولی نمی‌تواند این را انجام دهد چون قبل از هر
// JSِ دیگر و **همزمان** با اولین paint باید اجرا شود — تنها راهِ درستِ این الگو
// یک <script> خام است، نه useEffect (که بعدِ اولین رندر اجرا می‌شود).
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("tile.theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t);}catch(e){}})();`;

// suppressHydrationWarning: THEME_INIT_SCRIPT بالا data-theme را قبل از هیدریتِ React
// روی <html> می‌نشاند — سرور از localStorage خبر ندارد، پس این تفاوت همیشگی و
// بی‌خطر است؛ بدونِ این پرچم React هر بار در کنسول هشدارِ mismatch می‌داد.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
