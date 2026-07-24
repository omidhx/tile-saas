import { NextResponse } from "next/server";
import { sql } from "@/db/client";
import { verifyPassword } from "@/auth/password";
import { setSessionCookie } from "@/auth/session";
import { checkRate, clientIp, tooMany } from "@/auth/rateLimit";

// app_user سراسریه (بدون tenant_id/RLS) — لاگین قبل از انتخاب tenant اتفاق می‌افته.
// v3: identifier می‌تواند موبایل یا ایمیل باشد — قطعیِ SMS نباید یعنی کاربر
// اصلاً نتواند وارد شود، وقتی رمز را از قبل دارد و ایمیلش ثبت است.
export async function POST(req: Request) {
  const { identifier, password } = await req.json().catch(() => ({}));
  if (typeof identifier !== "string" || typeof password !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  // rate limit دولایه (spec ۸): per-IP جلوی اسپری‌کردن روی کاربرهای مختلف،
  // per-identifier جلوی brute-force روی یک حساب از IPهای چرخان.
  const byIp = checkRate(`login:ip:${clientIp(req)}`, 20, 15 * 60_000);
  if (!byIp.ok) return tooMany(byIp.retryAfterSec);
  const byId = checkRate(`login:id:${identifier}`, 5, 15 * 60_000);
  if (!byId.ok) return tooMany(byId.retryAfterSec);

  const [user] = await sql<{ id: string; password_hash: string; is_active: boolean }[]>`
    SELECT id, password_hash, is_active FROM app_user WHERE phone = ${identifier} OR email = ${identifier}`;

  // عدم افشای وجود/عدم‌وجود کاربر (spec بخش ۸): پیام یکسان برای هر شکست.
  // verify روی هش الکی هم اجرا می‌شه تا زمان‌بندی کاربرِ ناموجود لو نده (timing).
  const ok =
    user && user.is_active
      ? await verifyPassword(password, user.password_hash)
      : (await verifyPassword(password, "$2a$12$0000000000000000000000000000000000000000000000000000"), false);

  if (!ok) return NextResponse.json({ error: "نام کاربری یا رمز اشتباه است" }, { status: 401 });

  await setSessionCookie(user.id);
  return NextResponse.json({ ok: true });
}
