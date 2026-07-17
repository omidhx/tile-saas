import { NextResponse } from "next/server";
import { sql } from "@/db/client";
import { currentUserId } from "@/auth/session";

// context‌های کاربر (tenant/نمایندگی). از user_contexts (SECURITY DEFINER) که
// bootstrapِ cross-tenant را امن از RLS عبور می‌ده. userId از JWT، نه کلاینت.
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rows = await sql<
    { tenant_id: string; tenant_name: string; agent_account_id: string; agent_legal_name: string }[]
  >`SELECT * FROM user_contexts(${userId})`;

  return NextResponse.json({
    contexts: rows.map((r) => ({
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      agentAccountId: r.agent_account_id,
      agentLegalName: r.agent_legal_name,
    })),
  });
}
