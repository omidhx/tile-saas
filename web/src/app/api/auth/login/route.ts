import { NextResponse } from "next/server";
import { sql } from "@/db/client";
import { verifyPassword } from "@/auth/password";
import { setSessionCookie } from "@/auth/session";
import { checkRateAsync, clientIp, tooMany } from "@/auth/rateLimit";
import { assertSameOrigin } from "@/auth/csrf";

// app_user سراسریه (بدون tenant_id/RLS) — لاگین قبل از انتخاب tenant اتفاق می‌افته.
// v3: identifier می‌تواند موبایل یا ایمیل باشد — قطعیِ SMS نباید یعنی کاربر
// اصلاً نتواند وارد شود، وقتی رمز را از قبل دارد و ایمیلش ثبت است.
export async function POST(req: Request) {
  // CSRF سبک: چکِ Origin/Host روی state-changing endpoints. SameSite=lax
  // روی مرورگرهای مدرن کافی است، ولی این چک، subdomain و WebView را هم
  // می‌پوشاند و حدود ۱۰ خط است — درِ اضافی که چیزی از دست نمی‌رود.
  const csrfFail = assertSameOrigin(req);
  if (csrfFail) return csrfFail;

  const { identifier, password } = await req.json().catch(() => ({}));
  if (typeof identifier !== "string" || typeof password !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  // rate limit دولایه (spec ۸): per-IP جلوی اسپری‌کردن روی کاربرهای مختلف،
  // per-identifier جلوی brute-force روی یک حساب از IPهای چرخان.
  // failPolicy=closed برای auth: اگر Postgres زیر فشارِ مهاجم باشد، سقف را
  // برنمی‌دارد — fallback به in-memory می‌زند تا حداقل داخلِ همین پروسه
  // محافظت بماند.
  const byIp = await checkRateAsync(
    `login:ip:${clientIp(req)}`, 20, 15 * 60_000,
    { failPolicy: "closed" },
  );
  if (!byIp.ok) return tooMany(byIp.retryAfterSec);
  const byId = await checkRateAsync(
    `login:id:${identifier}`, 5, 15 * 60_000,
    { failPolicy: "closed" },
  );
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
