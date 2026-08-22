import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * CSPِ script-src با nonce — الگوی رسمیِ خودِ Next برای App Router
 * (https://nextjs.org/docs/app/guides/content-security-policy).
 *
 * چرا اینجا و نه next.config.ts: nonce باید هر درخواست یک مقدارِ تصادفیِ تازه
 * باشد (وگرنه یک مهاجم که یک نمونه از آن را دید، برای همیشه از آن استفاده
 * می‌کند) — next.config.ts استاتیک است، فقط middleware به‌ازای هر request
 * اجرا می‌شود. nonce هم در هدرِ ریسپانس (CSP واقعی) و هم در هدرِ درخواست
 * (`x-nonce`) گذاشته می‌شود تا layout.tsx با `headers()` بخواندش و به
 * <script>ِ دستی بدهد؛ Next خودش هم اسکریپت‌های فریم‌ورک (hydration/
 * streaming chunkها) را با همین nonce امضا می‌کند.
 */
export function middleware(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  // React در dev برای بازسازیِ stack trace از eval() استفاده می‌کند (خودِ خطای
  // مرورگر این را می‌گوید) — production هیچ‌وقت eval نمی‌زند، پس unsafe-eval فقط
  // در dev اضافه می‌شود، نه در چیزی که واقعاً کاربر می‌بیند.
  const scriptSrc = process.env.NODE_ENV === "development"
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  const csp = [
    scriptSrc,
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  // فایلِ استاتیک/آپلود/API لازم ندارد؛ فقط مسیرهایی که واقعاً HTML رندر می‌کنند.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|uploads/).*)"],
};
