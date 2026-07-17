import { withTenant } from "@/db/client";

export class AuthzError extends Error {}

export type AgentContext = {
  userId: string;
  tenantId: string;
  agentAccountId: string;
  ttlHours: number;
};

/**
 * chokepoint دسترسی — قانون معماری #۸ (Authorization > Authentication، بزرگ‌ترین ریسک IDOR).
 * هرگز tenant/agent را از کلاینت باور نکن؛ همیشه در برابر DB تأیید کن:
 *   • کاربر عضو فعالِ این tenant هست؟
 *   • کاربر به این agent_account (که مالِ همین tenant است) وصله؟
 *
 * دفاع دولایه (belt & suspenders، مثل composite FK + RLS):
 *   • فیلترِ صریحِ tenant_id در کوئری (کار می‌کنه حتی اگه RLS خاموش/غلط باشه)
 *   • withTenant → RLS هم مستقلاً فیلتر می‌کنه
 * پرتاب AuthzError یعنی ۴۰۳.
 */
export async function authorizeAgent(
  userId: string,
  tenantId: string,
  agentAccountId: string,
): Promise<AgentContext> {
  return withTenant(tenantId, async (tx) => {
    const member = await tx`
      SELECT 1 FROM tenant_membership
      WHERE user_id = ${userId} AND tenant_id = ${tenantId} AND is_active
      LIMIT 1`;
    if (member.length === 0) throw new AuthzError("کاربر عضو این tenant نیست");

    const linked = await tx`
      SELECT 1 FROM agent_account_user
      WHERE user_id = ${userId} AND agent_account_id = ${agentAccountId}
        AND tenant_id = ${tenantId}
      LIMIT 1`;
    if (linked.length === 0) throw new AuthzError("کاربر به این نمایندگی وصل نیست");

    const [t] = await tx<{ ttl: number }[]>`
      SELECT default_reservation_ttl_hours AS ttl FROM tenant WHERE id = ${tenantId}`;
    if (!t) throw new AuthzError("tenant یافت نشد");

    return { userId, tenantId, agentAccountId, ttlHours: t.ttl };
  });
}
