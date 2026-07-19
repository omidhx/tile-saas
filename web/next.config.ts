import type { NextConfig } from "next";

// هدرهای امنیتی (spec بخش ۸). HSTS عمداً اینجا نیست — کارِ reverse proxy (Caddy/Nginx)
// است که TLS را terminate می‌کند؛ ست‌کردنش از اپ روی HTTP لوکال فقط دردسر می‌سازد.
const securityHeaders = [
  // clickjacking: پنل staff/نماینده نباید در iframe سایت دیگری بیفتد
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // جلوی MIME-sniffing (فایلی که مرورگر اجرایی تفسیرش کند)
  { key: "X-Content-Type-Options", value: "nosniff" },
  // مسیرهای داخلی (شامل idها) به سایت بیرونی درز نکند
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];
// ponytail: CSP کاملِ script-src عمداً ست نشده — Next برای hydration به inline نیاز دارد و
// بدون nonce-plumbing یا اپ را می‌شکند یا با 'unsafe-inline' عملاً بی‌اثر است. اینجا فقط
// frame-ancestors (مستقل و بی‌ریسک) گذاشته شده.
// upgrade path: وقتی nonce در layout پیاده شد، script-src 'self' 'nonce-…' اضافه شود.

const nextConfig: NextConfig = {
  poweredByHeader: false, // نسخه‌ی فریم‌ورک را لو نده
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
