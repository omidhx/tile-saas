import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { listSalesRequests } from "@/db/salesRequests";

/** GET /api/sales-requests?tenantId&status=approved — برای پنل staff (حواله‌سازی). */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const status = url.searchParams.get("status") ?? "approved";
  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
  const requests = await listSalesRequests({ tenantId, status });
  return NextResponse.json({ requests });
}
