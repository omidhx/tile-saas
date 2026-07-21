import { NextResponse } from "next/server";
import { currentUserId, setSessionCookie } from "@/auth/session";
import { changePassword } from "@/auth/passwordFlows";
import { checkRate } from "@/auth/rateLimit";

/** POST /api/auth/password — تغییر رمز توسط کاربرِ واردشده. */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // rate limit روی حدسِ «رمز فعلی» — این endpoint هم یک اوراکلِ رمز است
  const rl = checkRate(`pwchange:${userId}`, 5, 15 * 60_000);
  if (!rl.ok)
    return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });

  const body = await req.json().catch(() => ({}));
  const { currentPassword, newPassword } = body ?? {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const r = await changePassword({ userId, currentPassword, newPassword });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "wrong_current" ? 401 : 400 });

  // نشست‌ها باطل شدند — از جمله نشستِ خودِ همین کاربر. کوکیِ تازه می‌دهیم تا
  // کسی که رمزش را عوض کرده از سایتِ خودش پرت نشود؛ بقیه‌ی دستگاه‌ها بیرون می‌مانند.
  await setSessionCookie(userId);
  return NextResponse.json({ ok: true });
}
