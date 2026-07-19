import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/auth/session";

/**
 * POST /api/auth/logout — پاک‌کردن کوکی نشست.
 * POST است نه GET، تا با یک <img>/لینکِ سایتِ دیگر نشود کاربر را خارج کرد (CSRF).
 * ponytail: نشست JWT بی‌حالت است، پس «خروج از همه‌ی دستگاه‌ها» (spec ۸) نیاز به
 * نسخه‌گذاریِ توکن (مثلاً session_version روی app_user) دارد — وقتی تغییر رمز اضافه شد.
 */
export async function POST() {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
