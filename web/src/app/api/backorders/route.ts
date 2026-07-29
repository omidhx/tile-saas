import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { listBackorderItems } from "@/db/dispatches";

/** GET /api/backorders?tenantId[&q][&offset] — اقلامِ backorder برای پنل staff، صفحه‌بندی‌شده. */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const u = new URL(req.url);
  const tenantId = u.searchParams.get("tenantId") ?? "";
  const q = u.searchParams.get("q") ?? undefined;
  const offset = Number(u.searchParams.get("offset") ?? "0") || 0;
  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
  const { items, hasMore } = await listBackorderItems({ tenantId, q, offset });
  return NextResponse.json({ items, hasMore });
}
