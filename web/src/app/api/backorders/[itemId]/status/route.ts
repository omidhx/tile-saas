import { NextResponse } from "next/server";
import { z } from "zod";
import { id, isId, parse } from "@/lib/validate";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { setBackorderItemStatus, type BackorderStatus } from "@/db/dispatches";

const Body = z.object({
  tenantId: id,
  toStatus: z.enum(["pending_production", "ready", "fulfilled", "cancelled"] satisfies BackorderStatus[]),
});

/** POST /api/backorders/:itemId/status — گذارِ backorder_status یک item (staff). */
export async function POST(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { itemId } = await params;
  if (!isId(itemId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const p = parse(Body, await req.json().catch(() => null));
  if ("err" in p) return p.err;
  const { tenantId, toStatus } = p.data;
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
