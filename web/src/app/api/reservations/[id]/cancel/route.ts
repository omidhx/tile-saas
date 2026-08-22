import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeAgent, authorizeStaff, AuthzError } from "@/auth/authz";
import { cancelReservation } from "@/db/reservations";

/**
 * POST /api/reservations/:id/cancel — لغو رزرو (spec ۶: «نماینده/پشتیبان لغو کرد»).
 *  • با agentAccountId → نماینده دارد رزروِ **خودش** را لغو می‌کند (authorizeAgent).
 *  • بدون آن → پشتیبان هر رزروِ این tenant را لغو می‌کند (authorizeStaff).
 * موجودی بلافاصله آزاد می‌شود چون held فقط رزروهای active را می‌شمارد.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id: reservationId } = await params;
  const body = await req.json().catch(() => ({}));
  const { tenantId, agentAccountId } = body ?? {};
  if (typeof tenantId !== "string") return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    if (typeof agentAccountId === "string") await authorizeAgent(userId, tenantId, agentAccountId);
    else await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const result = await cancelReservation({
    tenantId, reservationId, actorUserId: userId,
    agentAccountId: typeof agentAccountId === "string" ? agentAccountId : undefined,
  });
  if (!result.ok)
    return NextResponse.json({ error: result.reason }, { status: result.reason === "not_found" ? 404 : 409 });
  return NextResponse.json({ ok: true });
}
