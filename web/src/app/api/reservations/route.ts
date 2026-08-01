import { NextResponse } from "next/server";
import { staffCtx, agentCtx } from "@/auth/httpCtx";
import { checkRate, tooMany } from "@/auth/rateLimit";
import { reserve, listReservations, type ReserveItem } from "@/db/reservations";

/**
 * GET /api/reservations?tenantId[&agentAccountId]
 *  - با agentAccountId → رزروهای همان نماینده (صفحه‌ی «رزروهای من»)، gate: agentCtx.
 *  - بدون آن → رزروهای active همه‌ی نماینده‌ها برای تأیید (پنل staff)، gate: staffCtx.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId");
  const agentAccountId = url.searchParams.get("agentAccountId");
  const c = agentAccountId ? await agentCtx(tenantId, agentAccountId) : await staffCtx(tenantId);
  if ("err" in c) return c.err;
  const reservations = await listReservations({ tenantId: c.tenantId, agentAccountId: agentAccountId ?? undefined });
  return NextResponse.json({ reservations });
}

/**
 * POST /api/reservations
 * ترتیب حیاتی: احراز هویت (کیه) → مجوز (chokepoint IDOR) → رزرو.
 * tenant/agent از body میان ولی *باور نمی‌شن* — agentCtx در برابر DB تأییدشون می‌کنه.
 * ttlHours از خودِ tenant خونده می‌شه، نه از کلاینت.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, agentAccountId, idempotencyKey, items } = body ?? {};
  if (
    typeof idempotencyKey !== "string" ||
    !Array.isArray(items) ||
    items.length === 0
  )
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const c = await agentCtx(tenantId, agentAccountId);
  if ("err" in c) return c.err;

  // rate limit روی رزرو (spec ۸): جلوی hammer کردنِ مسیر پول/موجودی توسط یک کاربر
  const rl = checkRate(`reserve:${c.userId}`, 30, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const result = await reserve({
    tenantId: c.tenantId,
    agentAccountId: c.agentAccountId,
    ttlHours: c.ttlHours,
    idempotencyKey,
    items: items as ReserveItem[],
  });

  if (!result.ok) {
    if ("idempotencyMismatch" in result)
      // همون کلید با payload متفاوت — کلاینت باید کلید تازه بفرسته
      return NextResponse.json({ error: "idempotency_key_conflict" }, { status: 409 });
    // ۴۰۹ — کلاینت پیام «موجودی فعلی: X» می‌سازه (بخش ۱۱.۵ wireframe)
    return NextResponse.json({ error: "conflict", ...result.conflict }, { status: 409 });
  }

  // autoApproved (v2): نماینده باید بداند سفارشش همین حالا قطعی شد یا در صفِ تأیید است —
  // «رزرو ثبت شد» برای هر دو حالت، یکی از آن‌ها را غلط توصیف می‌کند.
  return NextResponse.json(
    { reservationId: result.reservationId, autoApproved: result.autoApproved ?? null },
    { status: result.deduped ? 200 : 201 },
  );
}
