import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { listMovements, findDrift } from "@/db/ledger";

/**
 * GET /api/ledger?tenantId[&lotId] — حرکات لجر + گزارش ناترازی (staff).
 * staff-only: لجر شاملِ همه‌ی نمایندگی‌هاست.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const u = new URL(req.url);
  const tenantId = u.searchParams.get("tenantId") ?? "";
  const lotId = u.searchParams.get("lotId") ?? undefined;
  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const [movements, drift] = await Promise.all([
    listMovements({ tenantId, lotId }),
    findDrift(tenantId),
  ]);
  return NextResponse.json({ movements, drift });
}
