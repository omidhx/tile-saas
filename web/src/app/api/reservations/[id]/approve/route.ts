import { NextResponse } from "next/server";
import { z } from "zod";
import { id, isId, parse } from "@/lib/validate";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { approveReservation } from "@/db/salesRequests";

const Body = z.object({ tenantId: id });

/**
 * POST /api/reservations/:id/approve
 * تأیید تجاریِ رزرو → SalesRequest (held → allocated، اتمیک). **staff-only** (spec ۵.۶).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id: reservationId } = await params;
  if (!isId(reservationId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const p = parse(Body, await req.json().catch(() => null));
  if ("err" in p) return p.err;
  const { tenantId } = p.data;

  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const result = await approveReservation({ tenantId, reservationId, actorUserId: userId });
  if (!result.ok) {
    if (result.reason === "not_found") return NextResponse.json({ error: "not_found" }, { status: 404 });
    // not_active: منقضی یا قبلاً تبدیل‌شده — رزرو دیگه قابل تأیید نیست
    return NextResponse.json({ error: "reservation_not_active" }, { status: 409 });
  }
  return NextResponse.json({ salesRequestId: result.salesRequestId }, { status: 201 });
}
