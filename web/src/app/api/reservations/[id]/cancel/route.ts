import { NextResponse } from "next/server";
import { z } from "zod";
import { id, isId, parse } from "@/lib/validate";
import { currentUserId } from "@/auth/session";
import { authorizeAgent, authorizeStaff, AuthzError } from "@/auth/authz";
import { cancelReservation } from "@/db/reservations";

const Body = z.object({ tenantId: id, agentAccountId: id.nullish() });

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
  if (!isId(reservationId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const p = parse(Body, await req.json().catch(() => null));
  if ("err" in p) return p.err;
  const { tenantId, agentAccountId } = p.data;

  try {
    if (agentAccountId) await authorizeAgent(userId, tenantId, agentAccountId);
    else await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const result = await cancelReservation({
    tenantId, reservationId, actorUserId: userId,
    agentAccountId: agentAccountId ?? undefined,
  });
  if (!result.ok)
    return NextResponse.json({ error: result.reason }, { status: result.reason === "not_found" ? 404 : 409 });
  return NextResponse.json({ ok: true });
}
