import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Middleware با سه مسئولیت:
 *
 *   ۱. Rate limit ساده‌ی IP-based برای mutation methods (global defense)
 *   ۲. CSRF سبک — چکِ Origin/Host روی تمام mutationهای cookie-based
 *   ۳. CSPِ script-src با nonce + HSTS
 *
 * نکته: middleware در Edge runtime اجرا می‌شود — نمی‌تواند به PostgreSQL وصل شود.
 * این rate limit ساده‌ی in-memory است (IP-based). rate limit دقیق‌تر (per-user)
 * در route handlerها با checkRateAsync پیاده شده.
 */

// ──────────────────────────────────────────────────────────
// Rate limit ساده‌ی IP-based (Edge-compatible)
// ──────────────────────────────────────────────────────────
// این یک لایه‌ی دفاعی اضافی است. rate limit دقیق‌تر (per-user, per-route)
// در route handlerها با checkRateAsync پیاده شده.
const ipHits = new Map<string, number[]>();
const IP_MAX_KEYS = 5_000;
const IP_STALE_MS = 24 * 60 * 60 * 1000;
const IP_RATE_LIMIT = 100; // ۱۰۰ mutation در دقیقه per IP
const IP_RATE_WINDOW = 60_000;

function checkIpRate(ip: string, now = Date.now()): boolean {
  if (ipHits.size > IP_MAX_KEYS) {
    for (const [k, times] of ipHits)
      if (times.length === 0 || now - times[times.length - 1] > IP_STALE_MS) ipHits.delete(k);
  }
  const recent = (ipHits.get(ip) ?? []).filter((t) => now - t < IP_RATE_WINDOW);
  if (recent.length >= IP_RATE_LIMIT) {
    ipHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  ipHits.set(ip, recent);
  return true;
}

function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export function proxy(req: NextRequest) {
  const method = req.method.toUpperCase();
  const isMutation = method === "POST" || method === "PATCH" || method === "PUT" || method === "DELETE";

  // ──────────────────────────────────────────────────────────
  // ۱. Rate limit ساده‌ی IP-based برای mutation methods
  // ──────────────────────────────────────────────────────────
  if (isMutation) {
    const ip = getClientIp(req);
    if (!checkIpRate(ip)) {
      return NextResponse.json(
        { error: "too_many_requests" },
        { status: 429, headers: { "retry-after": "60" } },
      );
    }
  }

  // ──────────────────────────────────────────────────────────
  // ۲. CSRF سبک — روی mutation methods
  // ──────────────────────────────────────────────────────────
  if (isMutation) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");

    if (host) {
      if (origin === "null") {
        return NextResponse.json(
          { error: "null_origin_forbidden" },
          { status: 403 },
        );
      }
      if (origin) {
        try {
          const url = new URL(origin);
          if (url.host !== host) {
            return NextResponse.json(
              { error: "cross_origin_forbidden" },
              { status: 403 },
            );
          }
        } catch {
          return NextResponse.json(
            { error: "invalid_origin" },
            { status: 400 },
          );
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // ۳. CSP با nonce
  // ──────────────────────────────────────────────────────────
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
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
  // ۴. HSTS در production — فقط اگر پشتِ reverse proxy مورداعتماد است
  // ──────────────────────────────────────────────────────────
  // ⚠️ مهم: X-Forwarded-Proto فقط زمانی قابل اعتماد است که reverse proxy
  // آن را پاک‌سازی و بازنویسی کند. اگر اپ مستقیماً در معرض اینترنت باشد،
  // مهاجم می‌تواند این header را بفرستد و HSTS را روی HTTP فعال کند.
  //
  // مدلِ deploymentِ این پروژه: اپ همیشه پشتِ Caddy/Nginx اجرا می‌شود
  // (نگاه کن به GO_LIVE.md). Caddy/Nginx باید:
  //   - X-Forwarded-Proto را فقط از خروجیِ TLS خودش ست کند
  //   - هر X-Forwarded-Proto از سمت client را حذف کند
  //   - یا proxy_set_header X-Forwarded-Proto $scheme (Nginx)
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
  // فایلِ استاتیک/API لازم ندارد؛ فقط مسیرهایی که واقعاً HTML رندر می‌کنند
  // یا API routeها (برای CSRF check و rate limit).
  // نکته: `uploads/` دیگر معاف نیست چون فایل‌ها در `private/uploads/` هستند
  // و فقط از طریق `/api/uploads/[id]` با احراز هویت قابل دسترسی هستند.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json).*)"],
};
