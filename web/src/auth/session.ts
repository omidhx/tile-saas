import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import type { TransactionSql } from "postgres";
import { sql } from "@/db/client";

// JWT امضاشده در کوکی HttpOnly — crypto دست‌ساز نیست (jose جاافتاده‌ست).
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET!);
const COOKIE = "session";

export async function issueSession(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

/** کوکی نشست را ست می‌کنه (spec بخش ۸: HttpOnly + Secure + SameSite). */
export async function setSessionCookie(userId: string) {
  const token = await issueSession(userId);
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production", // در dev روی http، کوکی Secure برنمی‌گرده
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

/**
 * userId از کوکی، یا null اگر نبود/نامعتبر/**باطل‌شده** بود.
 *
 * فقط امضا کافی نیست: JWT تا ۷ روز معتبر می‌ماند و هیچ راهی برای پس‌گرفتنش نیست.
 * پس بعد از تغییر/بازیابیِ رمز، `sessions_valid_from` کاربر جلو می‌رود و هر توکنی
 * که `iat`اش قدیمی‌تر باشد رد می‌شود — یعنی «خروج از همه‌ی دستگاه‌ها».
 * بدون این، عوض‌کردنِ رمز نشستِ دزدیده‌شده را نمی‌کشت و امنیتِ نمایشی بود.
 *
 * هزینه: یک lookup روی PK در هر درخواستِ احرازشده. هر route بعدش هم یک کوئریِ
 * authz می‌زند، پس این یکی در عمل نامحسوس است — و مسیرِ امنیتی جای بهینه‌سازیِ
 * زودهنگام نیست.
 */
export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const userId = (payload.sub as string) ?? null;
    if (!userId || typeof payload.iat !== "number") return null;

    const [u] = await sql<{ valid_from: Date; is_active: boolean }[]>`
      SELECT sessions_valid_from AS valid_from, is_active FROM app_user WHERE id = ${userId}`;
    // کاربرِ حذف‌شده یا غیرفعال‌شده هم همین‌جا می‌افتد، نه فقط توکنِ باطل
    if (!u || !u.is_active) return null;
    if (payload.iat * 1000 < u.valid_from.getTime()) return null;

    return userId;
  } catch {
    return null; // امضای نامعتبر/منقضی
  }
}

/**
 * همه‌ی نشست‌های این کاربر را باطل می‌کند (خروج از همه‌ی دستگاه‌ها).
 * `tx` می‌گیرد تا در همان تراکنشِ تغییرِ رمز اجرا شود — وگرنه پنجره‌ای می‌ماند که
 * رمز عوض شده ولی نشست‌های قدیمی هنوز زنده‌اند.
 *
 * `date_trunc('second')`: `iat` در JWT ثانیه‌ای است؛ اگر این مقدار کسرِ ثانیه داشته
 * باشد، توکنی که در همان ثانیه صادر شده به‌غلط باطل می‌شود.
 */
export async function invalidateSessionsIn(tx: TransactionSql, userId: string) {
  await tx`UPDATE app_user SET sessions_valid_from = date_trunc('second', now()) WHERE id = ${userId}`;
}
