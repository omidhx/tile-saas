import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { getDispatchDetail } from "@/db/dispatches";

/** GET /api/sales-dispatches/:id?tenantId — جزئیاتِ حواله برای برگه‌ی چاپیِ انباردار. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id: dispatchId } = await params;
  const tenantId = new URL(req.url).searchParams.get("tenantId") ?? "";
  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const dispatch = await getDispatchDetail(tenantId, dispatchId);
  if (!dispatch) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ dispatch });
}
