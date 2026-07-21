import { NextResponse } from "next/server";
import { requestReset, confirmReset } from "@/auth/passwordFlows";
import { checkRate } from "@/auth/rateLimit";

/**
 * POST /api/auth/reset — بازیابی رمز با کدِ پیامکی.
 *   { phone }                        → درخواستِ کد
 *   { phone, code, newPassword }     → ثبتِ رمز جدید
 *
 * **هیچ‌کدام وجودِ شماره را لو نمی‌دهند.** درخواست همیشه ۲۰۰ می‌گیرد و تأیید برای
 * شماره‌ی ناموجود همان «کد نامعتبر» را می‌دهد؛ وگرنه این endpoint ابزارِ شمارشِ
 * شماره‌های نمایندگان می‌شد.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { phone, code, newPassword } = body ?? {};
  if (typeof phone !== "string" || !phone.trim())
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  // کلید بر اساس شماره: مهاجم نباید بتواند با درخواستِ پیاپی هم پیامک اسپم کند
  // هم کد را بارها عوض کند. (spec ۸: rate limit روی مسیرهای احراز هویت.)
  const isConfirm = typeof code === "string";
  const rl = checkRate(`reset:${isConfirm ? "c" : "r"}:${phone}`, isConfirm ? 10 : 3, 15 * 60_000);
  if (!rl.ok)
    return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });

  if (!isConfirm) {
    await requestReset(phone);
    // پاسخ عمداً بی‌تفاوت است — چه کاربر باشد چه نباشد
    return NextResponse.json({ ok: true });
  }

  if (typeof newPassword !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const r = await confirmReset({ phone, code, newPassword });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  return NextResponse.json({ ok: true });
}
