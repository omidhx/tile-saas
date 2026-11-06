import { NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/validate";
import { requestReset, confirmReset } from "@/auth/passwordFlows";
import { checkRateAsync } from "@/auth/rateLimit";
import { assertSameOrigin } from "@/auth/csrf";

// بدونِ code = درخواستِ کد؛ با code = تأیید، که newPassword هم لازم دارد.
const Reset = z.object({
  identifier: z.string().trim().min(1), code: z.string().optional(), newPassword: z.string().optional(),
}).refine((v) => v.code === undefined || v.newPassword !== undefined, { path: ["newPassword"] });

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
  const csrfFail = assertSameOrigin(req);
  if (csrfFail) return csrfFail;

  const p = parse(Reset, await req.json().catch(() => null));
  if ("err" in p) return p.err;
  const { identifier, code, newPassword } = p.data;

  // کلید بر اساس شناسه: مهاجم نباید بتواند با درخواستِ پیاپی هم صف را پر کند
  // هم کد را بارها عوض کند. (spec ۸: rate limit روی مسیرهای احراز هویت.)
  // failPolicy=closed: اگر DB در دسترس نباشد، fallback به in-memory می‌زند.
  const isConfirm = code !== undefined;
  const rl = await checkRateAsync(
    `reset:${isConfirm ? "c" : "r"}:${identifier}`,
    isConfirm ? 10 : 3, 15 * 60_000,
    { failPolicy: "closed" },
  );
  if (!rl.ok)
    return NextResponse.json({ error: "too_many" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });

  if (!isConfirm) {
    await requestReset(identifier);
    // پاسخ عمداً بی‌تفاوت است — چه کاربر باشد چه نباشد
    return NextResponse.json({ ok: true });
  }

  const r = await confirmReset({ identifier, code, newPassword: newPassword! });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 400 });
  return NextResponse.json({ ok: true });
}
