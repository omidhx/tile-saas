import { NextResponse } from "next/server";
import { currentUserId, setSessionCookie, invalidateSessionsIn } from "@/auth/session";
import { sql } from "@/db/client";
import { checkRateAsync, tooMany } from "@/auth/rateLimit";

/**
 * POST /api/auth/logout-all — خروج از همه‌ی دستگاه‌ها.
 *
 * رمز نمی‌خواهد و لازم هم ندارد: اگر مهاجمی با نشستِ دزدیده این را بزند،
 * نشستِ **خودش هم** می‌میرد و فقط کسی که رمز را دارد می‌تواند دوباره وارد شود.
 * یعنی برای مهاجم خودزنی است، پس اصطکاکِ اضافه فقط به ضررِ کاربرِ واقعی بود.
 *
 * دستگاهِ فعلی داخل می‌ماند (کوکیِ تازه صادر می‌شود) — همان رفتارِ تغییرِ رمز.
 * کاربری که نگرانِ نشستِ دزدیده است نباید برای بیرون‌کردنِ او، خودش هم بیفتد بیرون.
 *
 * Rate limit: ۵ در ۱۵ دقیقه — جلوی تکرارِ بی‌دلیل را می‌گیرد.
 */
export async function POST() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rl = await checkRateAsync(`logout-all:${userId}`, 5, 15 * 60_000, { failPolicy: "closed" });
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  await sql.begin((tx) => invalidateSessionsIn(tx, userId));
  await setSessionCookie(userId);

  return NextResponse.json({ ok: true });
}
