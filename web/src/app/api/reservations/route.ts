import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeAgent, AuthzError } from "@/auth/authz";
import { reserve, type ReserveItem } from "@/db/reservations";

/**
 * POST /api/reservations
 * ترتیب حیاتی: احراز هویت (کیه) → مجوز (chokepoint IDOR) → رزرو.
 * tenant/agent از body میان ولی *باور نمی‌شن* — authorizeAgent در برابر DB تأییدشون می‌کنه.
 * ttlHours از خودِ tenant خونده می‌شه، نه از کلاینت.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { tenantId, agentAccountId, idempotencyKey, items } = body ?? {};
  if (
    typeof tenantId !== "string" ||
    typeof agentAccountId !== "string" ||
    typeof idempotencyKey !== "string" ||
    !Array.isArray(items) ||
    items.length === 0
  )
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  let ctx;
  try {
    ctx = await authorizeAgent(userId, tenantId, agentAccountId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const result = await reserve({
    tenantId: ctx.tenantId,
    agentAccountId: ctx.agentAccountId,
    ttlHours: ctx.ttlHours,
    idempotencyKey,
    items: items as ReserveItem[],
  });

  if (!result.ok)
    // ۴۰۹ — کلاینت پیام «موجودی فعلی: X» می‌سازه (بخش ۱۱.۵ wireframe)
    return NextResponse.json({ error: "conflict", ...result.conflict }, { status: 409 });

  return NextResponse.json(
    { reservationId: result.reservationId },
    { status: result.deduped ? 200 : 201 },
  );
}
