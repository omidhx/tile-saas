import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware با دو مسئولیت:
 *
 *   ۱. CSPِ script-src با nonce — الگوی رسمیِ خودِ Next برای App Router
 *      (https://nextjs.org/docs/app/guides/content-security-policy).
 *
 *   ۲. CSRF سبک — چکِ Origin/Host روی تمام mutationهای cookie-based
 *      (POST/PATCH/PUT/DELETE). `SameSite=lax` روی مرورگرهای مدرن کافی است،
 *      ولی این چک subdomain و WebView را هم می‌پوشاند.
 *
 * چرا اینجا و نه next.config.ts: nonce و CSRF باید هر درخواست بررسی شوند —
 * next.config.ts استاتیک است، فقط middleware به‌ازای هر request اجرا می‌شود.
 */
export function middleware(req: NextRequest) {
  // ──────────────────────────────────────────────────────────
  // ۱. CSRF سبک — روی mutation methods
  // ──────────────────────────────────────────────────────────
  const method = req.method.toUpperCase();
  const isMutation = method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";

  if (isMutation) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");

    if (host) {
      if (origin) {
        // Origin آمد — با Host مقایسه کن
        try {
          const url = new URL(origin);
          if (url.host !== host) {
            return NextResponse.json(
              { error: "cross_origin_forbidden" },
              { status: 403 },
            );
          }
        } catch {
          // Origin malformed — رد کن
          return NextResponse.json(
            { error: "invalid_origin" },
            { status: 400 },
          );
        }
      }
      // اگر Origin نبود (مرورگر قدیمی یا API client بدون browser):
      // SameSite=lax بقیه‌ی کار را می‌کند. API client (curl/Postman) کوکی
      // نمی‌فرستد، پس مجاز است. نرم می‌گیریم.
    }
    // اگر host نبود، نرم می‌گیریم تا اپراتور متوجه شود (در next.config.ts
    // می‌توان hard fail گذاشت).
  }

  // ──────────────────────────────────────────────────────────
  // ۲. CSP با nonce
  // ──────────────────────────────────────────────────────────
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

  // ──────────────────────────────────────────────────────────
  // ۳. HSTS در production — فقط اگر پشتِ reverse proxy با HTTPS است
  // ──────────────────────────────────────────────────────────
  // HSTS فقط روی HTTPS معنا دارد. اگر کاربر مستقیم روی HTTP وصل شود،
  // HSTS نباید ست شود چون مرورگر آن را نادیده می‌گیرد و ممکن است
  // رفتار عجیبی ایجاد کند. reverse proxy (Caddy/Nginx) X-Forwarded-Proto
  // می‌فرستد که نشان می‌دهد درخواست HTTPS بوده.
  if (process.env.NODE_ENV === "production") {
    const forwardedProto = req.headers.get("x-forwarded-proto");
    if (forwardedProto === "https") {
      res.headers.set(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
    }
  }

  return res;
}

export const config = {
  // فایلِ استاتیک/آپلود/API لازم ندارد؛ فقط مسیرهایی که واقعاً HTML رندر می‌کنند
  // یا API routeها (برای CSRF check).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|uploads/).*)"],
};
