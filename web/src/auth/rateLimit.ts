// Rate limiting — spec بخش ۸ («rate limiting روی لاگین/رزرو»).
//
// این ماژول از دو لایه تشکیل شده:
//
//   ۱. لایه‌ی in-memory (پیش‌فرض) — برای dev و production با تک-instance.
//      سقف مؤثر فقط داخلِ همین پروسه معتبر است. با ری‌استارت صفر می‌شود.
//
//   ۲. لایه‌ی Postgres (اختیاری) — وقتی `RATE_LIMIT_BACKEND=postgres` در .env
//      باشد، از جدول `_rate_limit_hits` در Postgres استفاده می‌کند. این برای
//      production با چند instance ضروری است (سقف واقعاً global می‌شود).
//      ponytail: Redis برای این مقیاس over-engineering است؛ ولی Postgres که
//      از قبل داریم، می‌تواند همین کار را با یک جدول کوچک انجام دهد.
//
// سیاست شکست (fail policy) — خیلی مهم:
//
//   برای مسیرهای auth (login, password, reset): fail-CLOSED. اگر Postgres زیر
//   فشار مهاجم باشد، سقف را نباید برداشت — این دقیقاً همان لحظه‌ای است که
//   brute-force اتفاق می‌افتد. در این حالت، fallback به in-memory می‌زنیم
//   تا حداقل داخلِ همین پروسه محافظت بماند، و خطا را با Sentry لاگ می‌کنیم.
//
//   برای مسیرهای غیر auth (reservations, imports): fail-OPEN. اگر DB در دسترس
//   نباشد، درخواست را رد نمی‌کنیم — در دسترس بودن > rate limit. ولی لاگ
//   می‌کنیم تا اپراتور بداند.
//
// هر دو لایه رابطِ یکسانی دارند (`checkRate`)، پس فراخواننده تفاوتی نمی‌بیند.

import * as Sentry from "@sentry/nextjs";
import { sql } from "@/db/client";

const BACKEND = process.env.RATE_LIMIT_BACKEND ?? "memory";

const hits = new Map<string, number[]>();
const MAX_KEYS = 10_000; // محافظ حافظه: جلوی رشد بی‌نهایت با کلیدهای یکبارمصرف (IPهای متغیر)
const STALE_MS = 24 * 60 * 60 * 1000;

export type RateResult = { ok: boolean; retryAfterSec: number };

/**
 * هرس فقط کلیدهای واقعاً راکد — نه `clear()` کامل. با `clear()`، مهاجمی که با
 * تغییرِ x-forwarded-for می‌تواند کلید بسازد، به‌سادگی نقشه را پر و شمارنده‌ی
 * محافظتیِ **همه‌ی کاربرانِ دیگر** را هم صفر می‌کرد.
 */
function sweep(now: number) {
  for (const [k, times] of hits)
    if (times.length === 0 || now - times[times.length - 1] > STALE_MS) hits.delete(k);
}

/** in-memory sliding window — برای تک-instance. */
function checkRateMemory(key: string, limit: number, windowMs: number, now = Date.now()): RateResult {
  if (hits.size > MAX_KEYS) sweep(now);

  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    const retry = Math.ceil((windowMs - (now - recent[0])) / 1000);
    return { ok: false, retryAfterSec: Math.max(1, retry) };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Postgres-based sliding window — برای multi-instance.
 * پیاده‌سازی با یک تراکنش: DELETE قدیمی‌ها، COUNT، INSERT اگر مجاز.
 */
async function checkRatePostgres(
  key: string, limit: number, windowMs: number, now = Date.now(),
): Promise<RateResult> {
  const windowStart = new Date(now - windowMs);

  const result = await sql.begin(async (tx) => {
    await tx`DELETE FROM _rate_limit_hits WHERE key = ${key} AND hit_at < ${windowStart}`;

    const [{ count }] = await tx<{ count: string }[]>`
      SELECT COUNT(*)::text AS count FROM _rate_limit_hits WHERE key = ${key}`;

    const current = parseInt(count, 10);
    if (current >= limit) {
      const [oldest] = await tx<{ oldest: Date }[]>`
        SELECT MIN(hit_at) AS oldest FROM _rate_limit_hits WHERE key = ${key}`;
      const retry = oldest?.oldest
        ? Math.ceil((oldest.oldest.getTime() + windowMs - now) / 1000)
        : Math.ceil(windowMs / 1000);
      return { ok: false, retryAfterSec: Math.max(1, retry) };
    }

    await tx`INSERT INTO _rate_limit_hits (key, hit_at) VALUES (${key}, ${new Date(now)})`;
    return { ok: true, retryAfterSec: 0 };
  });

  return result;
}

/**
 * `checkRate` sync — فقط برای حالتِ memory. در حالتِ postgres اگر صدا زده
 * شود، throw می‌کند تا توسعه‌دهنده متوجه شود باید از `checkRateAsync` استفاده
 * کند. این تابع فقط برای حفظِ سازگاری با تست‌های موجود باقی مانده.
 */
export function checkRate(key: string, limit: number, windowMs: number, now = Date.now()): RateResult {
  if (BACKEND !== "postgres") return checkRateMemory(key, limit, windowMs, now);
  throw new Error(
    "RATE_LIMIT_BACKEND=postgres نیاز به `await checkRateAsync` دارد، نه `checkRate` sync. " +
    "یا RATE_LIMIT_BACKEND را برندار یا `checkRateAsync` را فراخوانی کن.",
  );
}

/**
 * نسخه‌ی async — برای زمانی که `RATE_LIMIT_BACKEND=postgres` است.
 *
 * `failPolicy`:
 *   - `"closed"` (پیش‌فرض برای auth): شکستِ DB → fallback به in-memory + لاگِ
 *     Sentry با سطحِ error. هرگز سقف را برنمی‌دارد.
 *   - `"open"` (پیش‌فرض برای غیر auth): شکستِ DB → درخواست مجاز است (rate limit
 *     از دست می‌رود ولی اپ کار می‌کند).
 */
export async function checkRateAsync(
  key: string, limit: number, windowMs: number,
  opts: { failPolicy?: "closed" | "open"; now?: number } = {},
): Promise<RateResult> {
  const failPolicy = opts.failPolicy ?? "open";
  const now = opts.now ?? Date.now();

  if (BACKEND !== "postgres") return checkRateMemory(key, limit, windowMs, now);

  try {
    return await checkRatePostgres(key, limit, windowMs, now);
  } catch (err) {
    // مهم: fail policy را رعایت کن
    if (failPolicy === "closed") {
      // fallback به in-memory — حداقل داخلِ همین پروسه محافظت بماند
      Sentry.captureException(err, {
        level: "error",
        tags: { component: "rate-limit", backend: "postgres", fallback: "memory" },
        extra: { key, limit, windowMs },
      });
      return checkRateMemory(key, limit, windowMs, now);
    }
    // fail-open: درخواست مجاز است ولی لاگ کن
    Sentry.captureException(err, {
      level: "warning",
      tags: { component: "rate-limit", backend: "postgres", fallback: "open" },
      extra: { key, limit, windowMs },
    });
    return { ok: true, retryAfterSec: 0 };
  }
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
