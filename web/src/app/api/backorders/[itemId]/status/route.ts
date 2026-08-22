import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { setBackorderItemStatus, type BackorderStatus } from "@/db/dispatches";

const VALID: BackorderStatus[] = ["pending_production", "ready", "fulfilled", "cancelled"];

/** POST /api/backorders/:itemId/status — گذارِ backorder_status یک item (staff). */
export async function POST(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { itemId } = await params;
  const body = await req.json().catch(() => ({}));
  const { tenantId, toStatus } = body ?? {};
  if (typeof tenantId !== "string" || !VALID.includes(toStatus))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
  const result = await setBackorderItemStatus({ tenantId, dispatchItemId: itemId, toStatus });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: result.reason === "not_found" ? 404 : 409 });
  return NextResponse.json({ status: result.status }, { status: 200 });
}
