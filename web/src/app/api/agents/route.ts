import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";

/** GET /api/agents?tenantId — نمایندگی‌های فعالِ tenant (برای فرم backorderِ staff). */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const tenantId = new URL(req.url).searchParams.get("tenantId") ?? "";
  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
  const agents = await withTenant(tenantId, (tx) =>
    tx`SELECT id, legal_name AS "legalName" FROM agent_account
       WHERE tenant_id = ${tenantId} AND is_active ORDER BY legal_name`,
  );
  return NextResponse.json({ agents });
}
