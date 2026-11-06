import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { z } from "zod";
import { id, isId, parse } from "@/lib/validate";
import { setDispatchStatus, type DispatchStatus } from "@/db/dispatches";

const Body = z.object({
  tenantId: id,
  toStatus: z.enum(["registered", "ready_for_loading", "loaded", "delivered", "cancelled"] satisfies DispatchStatus[]),
});

/**
 * POST /api/sales-dispatches/:id/status — گذارِ وضعیت (کارِ staff).
 * loaded → کم‌شدنِ اتمیکِ on_hand/allocated؛ idempotent و state-guarded (spec ۱۴.۳).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id: dispatchId } = await params;
  if (!isId(dispatchId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const p = parse(Body, await req.json().catch(() => null));
  if ("err" in p) return p.err;
  const { tenantId, toStatus } = p.data;

  try {
    await authorizeStaff(userId, tenantId);
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
