import { NextResponse } from "next/server";
import { sql } from "@/db/client";
import { currentUserId } from "@/auth/session";

// context‌های کاربر (tenant/نمایندگی). از user_contexts (SECURITY DEFINER) که
// bootstrapِ cross-tenant را امن از RLS عبور می‌ده. userId از JWT، نه کلاینت.
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rows = await sql<
    {
      tenant_id: string; tenant_name: string; agent_account_id: string | null; agent_legal_name: string | null;
      role: string; can_manage_access: boolean; allowed_pages: string[];
    }[]
  >`SELECT * FROM user_contexts(${userId})`;

  // agentAccountId برای کاربر staff نال است — UI باید هندلش کنه، نه اینکه قفل شه.
  return NextResponse.json({
    contexts: rows.map((r) => ({
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      agentAccountId: r.agent_account_id,
      agentLegalName: r.agent_legal_name,
      role: r.role,
      canManageAccess: r.can_manage_access,
      allowedPages: r.allowed_pages,
    })),
  });
}
