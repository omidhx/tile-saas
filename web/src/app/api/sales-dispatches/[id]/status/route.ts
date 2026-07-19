import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeTenantMember, AuthzError } from "@/auth/authz";
import { setDispatchStatus, type DispatchStatus } from "@/db/dispatches";

const VALID: DispatchStatus[] = ["registered", "ready_for_loading", "loaded", "delivered", "cancelled"];

/**
 * POST /api/sales-dispatches/:id/status — گذارِ وضعیت (کارِ staff).
 * loaded → کم‌شدنِ اتمیکِ on_hand/allocated؛ idempotent و state-guarded (spec ۱۴.۳).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id: dispatchId } = await params;
  const body = await req.json().catch(() => ({}));
  const { tenantId, toStatus } = body ?? {};
  if (typeof tenantId !== "string" || !VALID.includes(toStatus))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await authorizeTenantMember(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const result = await setDispatchStatus({ tenantId, dispatchId, toStatus, actorUserId: userId });
  if (!result.ok) {
    const status = result.reason === "not_found" ? 404 : 409;
    return NextResponse.json({ error: result.reason }, { status });
  }
  return NextResponse.json({ status: result.status }, { status: 200 });
}
