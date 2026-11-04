import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaffPage, AuthzError } from "@/auth/authz";
import { listAudit } from "@/db/audit";

/** GET /api/audit?tenantId[&q][&offset] — دفترِ تغییراتِ قواعدِ پولی، صفحه‌بندی‌شده. فقط staff. */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const u = new URL(req.url);
  const tenantId = u.searchParams.get("tenantId") ?? "";
  const q = u.searchParams.get("q") ?? undefined;
  const offset = Number(u.searchParams.get("offset") ?? "0") || 0;
  try {
    await authorizeStaffPage(userId, tenantId, "audit");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const { items: entries, hasMore } = await listAudit({ tenantId, q, offset });
  return NextResponse.json({ entries, hasMore });
}
