import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { approveReservation } from "@/db/salesRequests";

/**
 * POST /api/reservations/:id/approve
 * تأیید تجاریِ رزرو → SalesRequest (held → allocated، اتمیک). **staff-only** (spec ۵.۶).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id: reservationId } = await params;
  const body = await req.json().catch(() => ({}));
  const { tenantId } = body ?? {};
  if (typeof tenantId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

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
