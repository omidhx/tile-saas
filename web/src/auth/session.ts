import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

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
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

/** userId از کوکی، یا null اگر نبود/نامعتبر بود. */
export async function currentUserId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return (payload.sub as string) ?? null;
  } catch {
    return null; // امضای نامعتبر/منقضی
  }
}
