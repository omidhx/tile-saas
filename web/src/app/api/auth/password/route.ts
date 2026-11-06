import { NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/validate";
import { currentUserId, setSessionCookie } from "@/auth/session";
import { changePassword } from "@/auth/passwordFlows";
import { checkRateAsync } from "@/auth/rateLimit";
import { assertSameOrigin } from "@/auth/csrf";

const Change = z.object({ currentPassword: z.string(), newPassword: z.string() });

/** POST /api/auth/password — تغییر رمز توسط کاربرِ واردشده. */
export async function POST(req: Request) {
  const csrfFail = assertSameOrigin(req);
  if (csrfFail) return csrfFail;

  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // rate limit روی حدسِ «رمز فعلی» — این endpoint هم یک اوراکلِ رمز است.
  // failPolicy=closed: اگر DB در دسترس نباشد، fallback به in-memory می‌زند.
  const rl = await checkRateAsync(`pwchange:${userId}`, 5, 15 * 60_000, { failPolicy: "closed" });
  if (!rl.ok)
    return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });

  const p = parse(Change, await req.json().catch(() => null));
  if ("err" in p) return p.err;
  const { currentPassword, newPassword } = p.data;

  const r = await changePassword({ userId, currentPassword, newPassword });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "wrong_current" ? 401 : 400 });

  // نشست‌ها باطل شدند — از جمله نشستِ خودِ همین کاربر. کوکیِ تازه می‌دهیم تا
  // کسی که رمزش را عوض کرده از سایتِ خودش پرت نشود؛ بقیه‌ی دستگاه‌ها بیرون می‌مانند.
  await setSessionCookie(userId);
  return NextResponse.json({ ok: true });
}
