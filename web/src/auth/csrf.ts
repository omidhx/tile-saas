import { NextResponse } from "next/server";

/**
 * CSRF سبک — چکِ Origin/Host روی state-changing endpoints.
 *
 * چرا این کار را می‌کنیم در حالی که `SameSite=lax` هست؟
 *
 * `SameSite=lax` روی مرورگرهای مدرن برای cross-site POST کوکی را نمی‌فرستد، ولی:
 *   - subdomain (مثلاً `evil.example.com` روی `example.com`) در همان site حساب می‌شود.
 *   - WebView در اپ‌های موبایل ممکن است policy متفاوتی داشته باشند.
 *   - مرورگرهای قدیمی (که هنوز کاربر دارند) `SameSite` را نمی‌شناسند.
 *
 * این چک، Origin را با Host مقایسه می‌کند. اگر Origin نبود (مرورگرهای قدیمی)،
 * سخت نمی‌گیریم — `SameSite=lax` بقیه‌ی کار را می‌کند. ولی اگر Origin آمد و با
 * Host هم‌خوان نبود، رد می‌کنیم. این درِ اضافی است، نه جایگزینِ SameSite.
 *
 * برای endpointهای safe (GET/HEAD/OPTIONS) لازم نیست. فقط روی POST/PATCH/DELETE.
 */
export function assertSameOrigin(req: Request): NextResponse | null {
  const method = req.method.toUpperCase();
  // فقط روی state-changing methods
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!host) {
    // reverse proxy تنظیم نیست — بهتر است رد کنیم تا اپراتور متوجه شود
    return NextResponse.json(
      { error: "missing_host_header" },
      { status: 400 },
    );
  }

  if (!origin) {
    // مرورگر قدیمی یا درخواستِ non-browser (مثلاً curl). `SameSite=lax` بقیه‌ی کار
    // را می‌کند. در این حالت نرم می‌گیریم چون اگر سخت بگیریم، API clients را
    // می‌شکنیم — مثلاً اپ موبایل که بعداً اضافه می‌شود.
    return null;
  }

  // Origin به فرمِ `https://host[:port]` است. host را از آن استخراج کن.
  try {
    const url = new URL(origin);
    if (url.host !== host) {
      return NextResponse.json(
        { error: "cross_origin_forbidden" },
        { status: 403 },
      );
    }
  } catch {
    // Origin malformed — احتیاط کن
    return NextResponse.json(
      { error: "invalid_origin" },
      { status: 400 },
    );
  }

  return null;
}
