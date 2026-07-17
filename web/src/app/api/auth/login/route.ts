import { NextResponse } from "next/server";
import { sql } from "@/db/client";
import { verifyPassword } from "@/auth/password";
import { setSessionCookie } from "@/auth/session";

// app_user سراسریه (بدون tenant_id/RLS) — لاگین قبل از انتخاب tenant اتفاق می‌افته.
export async function POST(req: Request) {
  const { phone, password } = await req.json().catch(() => ({}));
  if (typeof phone !== "string" || typeof password !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const [user] = await sql<{ id: string; password_hash: string; is_active: boolean }[]>`
    SELECT id, password_hash, is_active FROM app_user WHERE phone = ${phone}`;

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
