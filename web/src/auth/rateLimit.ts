// Rate limiting — spec بخش ۸ («rate limiting روی لاگین/رزرو»).
//
// ponytail: شمارنده‌ی in-memory با پنجره‌ی لغزان. سقفش: فقط داخل همین پروسه معتبره،
// پس با PM2 cluster/چند instance هر پروسه شمارنده‌ی خودش را دارد (سقف مؤثر = limit×instances)
// و با ری‌استارت صفر می‌شود. برای این مقیاس (یک VPS، چند ده نماینده) کافیه.
// upgrade path: اگر چند-instance شد، همین امضا را با جدولِ Postgres یا Redis پیاده کن.
// (spec عمداً Redis را برای این مرحله رد کرده — بخش ۶.)

const hits = new Map<string, number[]>();
const MAX_KEYS = 10_000; // محافظ حافظه: جلوی رشد بی‌نهایت با کلیدهای یکبارمصرف (IPهای متغیر)
// فراتر از هر windowِ واقعیِ این اپ (لاگین/ریست/رزرو همه زیرِ چند دقیقه‌اند) — کلیدی
// که مدت‌هاست ضربه‌ی تازه نگرفته، قطعاً غیرِفعال است.
const STALE_MS = 24 * 60 * 60 * 1000;

export type RateResult = { ok: boolean; retryAfterSec: number };

/**
 * هرس فقط کلیدهای واقعاً راکد — نه `clear()` کامل. با `clear()`، مهاجمی که با
 * تغییرِ x-forwarded-for می‌تواند کلید بسازد، به‌سادگی نقشه را پر و شمارنده‌ی
 * محافظتیِ **همه‌ی کاربرانِ دیگر** را هم صفر می‌کرد — دقیقاً همان چیزی که این
 * فایل برایش ساخته شده. بدترین حالتِ این نسخه، رشدِ موقتِ حافظه است، نه خلعِ سلاحِ
 * محافظتِ همه.
 */
function sweep(now: number) {
  for (const [k, times] of hits)
    if (times.length === 0 || now - times[times.length - 1] > STALE_MS) hits.delete(k);
}

/** آیا این کلید مجاز است؟ هر فراخوانیِ مجاز، یک ضربه ثبت می‌کند. */
export function checkRate(key: string, limit: number, windowMs: number, now = Date.now()): RateResult {
  if (hits.size > MAX_KEYS) sweep(now);

  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    // قدیمی‌ترین ضربه کی از پنجره خارج می‌شه؟
    const retry = Math.ceil((windowMs - (now - recent[0])) / 1000);
    return { ok: false, retryAfterSec: Math.max(1, retry) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfterSec: 0 };
}

/** فقط برای تست. */
export function resetRates() { hits.clear(); }

/** IP کلاینت از هدرِ پروکسی (Nginx/Caddy). بدون پروکسی → unknown (همه یک سطل). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** پاسخ استاندارد ۴۲۹ با Retry-After. */
export function tooMany(retryAfterSec: number): Response {
  return new Response(JSON.stringify({ error: "too_many_requests" }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfterSec) },
  });
}
