import { NextResponse } from "next/server";
import { requestReset, confirmReset } from "@/auth/passwordFlows";
import { checkRate } from "@/auth/rateLimit";

/**
 * POST /api/auth/reset — بازیابیِ رمز با کدی که به همه‌ی کانال‌های موجودِ کاربر می‌رود.
 *   { identifier }                        → درخواستِ کد (identifier = موبایل یا ایمیل)
 *   { identifier, code, newPassword }     → ثبتِ رمز جدید
 *
 * **هیچ‌کدام وجودِ شناسه را لو نمی‌دهند.** درخواست همیشه ۲۰۰ می‌گیرد و تأیید برای
 * شناسه‌ی ناموجود همان «کد نامعتبر» را می‌دهد؛ وگرنه این endpoint ابزارِ شمارشِ
 * شماره‌ها/ایمیل‌های نمایندگان می‌شد.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { identifier, code, newPassword } = body ?? {};
  if (typeof identifier !== "string" || !identifier.trim())
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  // کلید بر اساس شناسه: مهاجم نباید بتواند با درخواستِ پیاپی هم صف را پر کند
  // هم کد را بارها عوض کند. (spec ۸: rate limit روی مسیرهای احراز هویت.)
  const isConfirm = typeof code === "string";
  const rl = checkRate(`reset:${isConfirm ? "c" : "r"}:${identifier}`, isConfirm ? 10 : 3, 15 * 60_000);
  if (!rl.ok)
    return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });

  if (!isConfirm) {
    await requestReset(identifier);
    // پاسخ عمداً بی‌تفاوت است — چه کاربر باشد چه نباشد
    return NextResponse.json({ ok: true });
  }

  if (typeof newPassword !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const r = await confirmReset({ identifier, code, newPassword });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  return NextResponse.json({ ok: true });
}
