import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaffPage, AuthzError } from "@/auth/authz";
import { listMovements, findDrift } from "@/db/ledger";

/**
 * GET /api/ledger?tenantId[&lotId][&q][&offset] — حرکات لجر (صفحه‌بندی‌شده) + گزارش ناترازی (staff).
 * staff-only: لجر شاملِ همه‌ی نمایندگی‌هاست.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const u = new URL(req.url);
  const tenantId = u.searchParams.get("tenantId") ?? "";
  const lotId = u.searchParams.get("lotId") ?? undefined;
  const q = u.searchParams.get("q") ?? undefined;
  const offset = Number(u.searchParams.get("offset") ?? "0") || 0;
  try {
    await authorizeStaffPage(userId, tenantId, "ledger");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const [{ items: movements, hasMore }, drift] = await Promise.all([
    listMovements({ tenantId, lotId, q, offset }),
    findDrift(tenantId),
  ]);
  return NextResponse.json({ movements, hasMore, drift });
}
