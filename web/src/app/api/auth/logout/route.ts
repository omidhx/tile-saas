import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/auth/session";

/**
 * POST /api/auth/logout — پاک‌کردن کوکی نشستِ همین دستگاه.
 * POST است نه GET، تا با یک <img>/لینکِ سایتِ دیگر نشود کاربر را خارج کرد (CSRF).
 * برای بی‌اعتبارکردنِ همه‌ی دستگاه‌ها به /api/auth/logout-all نگاه کن —
 * نسخه‌گذاریِ session_epoch همان‌جا پیاده شده.
 */
export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
