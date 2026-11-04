import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// هدرهای امنیتی (spec بخش ۸). HSTS عمداً اینجا نیست — کارِ reverse proxy (Caddy/Nginx)
// است که TLS را terminate می‌کند؛ ست‌کردنش از اپ روی HTTP لوکال فقط دردسر می‌سازد.
// Content-Security-Policy اینجا نیست — nonce باید هر request تازه باشد، پس در
// src/middleware.ts (که به‌ازای هر درخواست اجرا می‌شود، نه یک‌بار در build) ست می‌شود؛
// همان‌جا هم frame-ancestors 'none' هست، پس تکرارش اینجا لازم نیست.
const securityHeaders = [
  // clickjacking: پنل staff/نماینده نباید در iframe سایت دیگری بیفتد — X-Frame-Options
  // مستقل از CSP نگه داشته شده چون مرورگرهای خیلی قدیمی frame-ancestors را نمی‌خوانند.
  { key: "X-Frame-Options", value: "DENY" },
  // جلوی MIME-sniffing (فایلی که مرورگر اجرایی تفسیرش کند)
  { key: "X-Content-Type-Options", value: "nosniff" },
  // مسیرهای داخلی (شامل idها) به سایت بیرونی درز نکند
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false, // نسخه‌ی فریم‌ورک را لو نده
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  images: {
    // ponytail: پشتیبان می‌تواند برای عکسِ محصول هر URL دلخواهی paste کند (نه فقط
    // آپلودِ خودش) — یعنی remotePatterns یا باید wildcard باشد (پروکسیِ باز، ریسکِ
    // SSRF) یا آن قابلیت باید حذف شود. فعلاً بهینه‌سازی/پروکسیِ next/image خاموش
    // است؛ عکس مستقیم از src سرو می‌شود (مثلِ <img> قبلی). upgrade path: وقتی
    // Object Storageِ ایران (آروان/چابکان) نهایی شد، این را بردار و remotePatterns
    // را با همان دامنه پر کن.
    unoptimized: true,
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  // ponytail: source-map upload به سازمان/پروژه‌ی Sentry نیاز دارد (SENTRY_AUTH_TOKEN) —
  // بدونش build کار می‌کند فقط stack trace خام‌تر است. وقتی لازم شد، توکن را در CI بگذار.
});
