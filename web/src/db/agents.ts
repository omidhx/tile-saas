import { withTenant } from "./client";
import { findOrCreateUser } from "./users";
import { writeAudit, type AuditValue } from "./audit";

/** سقفِ اعتبار/تأییدِ خودکار: null (خاموش/ارث) یا عددِ صحیحِ نامنفی — همان قاعده‌ی /api/settings/auto-approve. */
function validLimit(v: number | null | undefined): boolean {
  return v === null || v === undefined || (Number.isSafeInteger(v) && v >= 0);
}

export type AgentUser = { userId: string; phone: string; email: string | null };
export type AgentFull = {
  id: string; legalName: string; code: string; isActive: boolean;
  priceListId: string | null; priceListName: string | null;
  creditLimit: number | null; autoApproveLimit: number | null;
  // v5 «پشتیبانِ ثابت»: کسی که پورسانتِ این نمایندگی را می‌گیرد و به نماینده
  // نشان داده می‌شود (reservations/sales-requests). Name/Phone برای نمایشِ
  // مستقیم در همین صفحه؛ Id برای پرکردنِ دراپ‌داونِ ویرایش.
  assignedStaffUserId: string | null; assignedStaffName: string | null; assignedStaffPhone: string | null;
  users: AgentUser[];
};

/** آیا این کاربر عضوِ فعالِ staff/adminِ همین tenant است؟ برای اعتبارسنجیِ assignedStaffUserId. */
async function isActiveStaffMember(tx: Parameters<Parameters<typeof withTenant>[1]>[0], tenantId: string, userId: string) {
  const [row] = await tx<{ x: number }[]>`
    SELECT 1 AS x FROM tenant_membership
    WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND role IN ('staff','admin') AND is_active`;
  return !!row;
}

/** فهرستِ کاملِ نمایندگی‌ها برای صفحه‌ی مدیریت — همراه با کاربرانِ هرکدام. */
export async function listAgentsFull(tenantId: string): Promise<AgentFull[]> {
  return withTenant(tenantId, async (tx) => {
    const agents = await tx<Omit<AgentFull, "users">[]>`
      SELECT aa.id, aa.legal_name AS "legalName", aa.code, aa.is_active AS "isActive",
             aa.price_list_id AS "priceListId", pl.name AS "priceListName",
             aa.credit_limit AS "creditLimit", aa.auto_approve_limit AS "autoApproveLimit",
             aa.assigned_staff_user_id AS "assignedStaffUserId",
             su.full_name AS "assignedStaffName", su.phone AS "assignedStaffPhone"
      FROM agent_account aa
      LEFT JOIN price_list pl ON pl.id = aa.price_list_id
      LEFT JOIN app_user su ON su.id = aa.assigned_staff_user_id
      WHERE aa.tenant_id = ${tenantId}
      ORDER BY aa.is_active DESC, aa.legal_name
      -- این صفحه «مدیریتِ همه‌ی نمایندگی‌ها»ست، نه جستجو — تعدادشان ذاتاً کم است
      -- (ده‌ها، نه هزاران). LIMIT فقط سقفِ دفاعی است، نه صفحه‌بندیِ واقعی.
      LIMIT 500`;
    if (agents.length === 0) return [];

    const users = await tx<{ agentAccountId: string; userId: string; phone: string; email: string | null }[]>`
      SELECT aau.agent_account_id AS "agentAccountId", u.id AS "userId", u.phone, u.email
      FROM agent_account_user aau
      JOIN app_user u ON u.id = aau.user_id
      WHERE aau.tenant_id = ${tenantId}
      ORDER BY u.phone`;
    const byAgent = new Map<string, AgentUser[]>();
    for (const u of users) {
      const list = byAgent.get(u.agentAccountId) ?? [];
      list.push({ userId: u.userId, phone: u.phone, email: u.email });
      byAgent.set(u.agentAccountId, list);
    }
    return agents.map((a) => ({ ...a, users: byAgent.get(a.id) ?? [] }));
  });
}

export type CreateAgentResult =
  // tempPassword فقط وقتی کاربرِ اول تازه ساخته شده پر است — مثلِ db/team.ts.
  | { ok: true; agentAccountId: string; tempPassword: string | null }
  | { ok: false; reason: "seat_limit" | "code_taken" | "email_taken" | "invalid_staff" | "invalid_limit" };

/** ساختِ نمایندگیِ تازه + کاربرِ اولش (find-or-create — همان قاعده‌ی db/team.ts). */
export async function createAgent(params: {
  tenantId: string; legalName: string; code: string;
  priceListId?: string | null; creditLimit?: number | null; autoApproveLimit?: number | null;
  assignedStaffUserId?: string | null;
  firstUserPhone: string; firstUserEmail?: string | null;
}): Promise<CreateAgentResult> {
  const { tenantId, legalName, code } = params;
  const email = params.firstUserEmail?.trim() || null;
  if (!validLimit(params.creditLimit) || !validLimit(params.autoApproveLimit))
    return { ok: false, reason: "invalid_limit" };

  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx<{ name: string; max_agents: number | null }[]>`
      SELECT name, max_agents FROM tenant WHERE id = ${tenantId}`;

    if (tenant.max_agents != null) {
      const [{ n }] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM agent_account WHERE tenant_id = ${tenantId} AND is_active`;
      if (n >= tenant.max_agents) return { ok: false, reason: "seat_limit" };
    }

    const [dupCode] = await tx<{ id: string }[]>`
      SELECT id FROM agent_account WHERE tenant_id = ${tenantId} AND code = ${code}`;
    if (dupCode) return { ok: false, reason: "code_taken" };

    if (params.assignedStaffUserId && !(await isActiveStaffMember(tx, tenantId, params.assignedStaffUserId)))
      return { ok: false, reason: "invalid_staff" };

    const found = await findOrCreateUser(tx, params.firstUserPhone, email);
    if (!found.ok) return found;
    const { userId, created, tempPassword } = found;

    const [agent] = await tx<{ id: string }[]>`
      INSERT INTO agent_account (tenant_id, legal_name, code, price_list_id, credit_limit, auto_approve_limit, assigned_staff_user_id)
      VALUES (${tenantId}, ${legalName}, ${code}, ${params.priceListId ?? null},
              ${params.creditLimit ?? null}, ${params.autoApproveLimit ?? null}, ${params.assignedStaffUserId ?? null})
      RETURNING id`;

    // عضویتِ کاربر در این tenant با نقشِ 'agent' — پیش‌نیازِ FK آی agent_account_user
    const [member] = await tx<{ id: string; is_active: boolean }[]>`
      SELECT id, is_active FROM tenant_membership WHERE tenant_id = ${tenantId} AND user_id = ${userId}`;
    if (member) {
      if (!member.is_active) await tx`UPDATE tenant_membership SET is_active = true WHERE id = ${member.id}`;
    } else {
      await tx`INSERT INTO tenant_membership (tenant_id, user_id, role, is_active) VALUES (${tenantId}, ${userId}, 'agent', true)`;
    }
    await tx`
      INSERT INTO agent_account_user (tenant_id, agent_account_id, user_id, role)
      VALUES (${tenantId}, ${agent.id}, ${userId}, 'op')`;

    const payload = created
      ? { type: "agent_invite", tenantName: tenant.name, agentName: legalName, identifier: params.firstUserPhone, tempPassword }
      : { type: "agent_invite", tenantName: tenant.name, agentName: legalName, identifier: params.firstUserPhone, tempPassword: "— با رمزِ فعلیِ خود وارد شوید —" };
    await tx`
      INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
      VALUES (${tenantId}, 'sms', ${params.firstUserPhone}, ${JSON.stringify(payload)}::jsonb)`;
    if (email)
      await tx`
        INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
        VALUES (${tenantId}, 'email', ${email}, ${JSON.stringify(payload)}::jsonb)`;

    return { ok: true, agentAccountId: agent.id, tempPassword };
  });
}

export type UpdateAgentResult = { ok: true } | { ok: false; reason: "code_taken" | "invalid_staff" | "invalid_limit" };

/**
 * ویرایشِ فیلدهای نمایندگی (شاملِ فعال/غیرفعال).
 *
 * سقفِ اعتبار/تأییدِ خودکار همان قواعدِ /api/settings/auto-approve را دارد: عددِ
 * صحیحِ نامنفی یا null — و چون این‌جا هم می‌تواند این دو ستون را عوض کند، باید
 * همان ردپا را هم بگذارد، وگرنه یک مسیرِ محافظت‌شده و یک مسیرِ بی‌محافظت برای
 * تغییرِ همان فیلدِ پولی می‌ماند (دقیقاً چیزی که audit_log برای جلوگیری‌اش ساخته شد).
 */
export async function updateAgent(params: {
  tenantId: string; agentAccountId: string; actorUserId: string;
  legalName?: string; code?: string; priceListId?: string | null;
  creditLimit?: number | null; autoApproveLimit?: number | null; isActive?: boolean;
  assignedStaffUserId?: string | null;
}): Promise<UpdateAgentResult> {
  const { tenantId, agentAccountId } = params;
  if (!validLimit(params.creditLimit) || !validLimit(params.autoApproveLimit))
    return { ok: false, reason: "invalid_limit" };
  return withTenant(tenantId, async (tx) => {
    if (params.code) {
      const [dup] = await tx<{ id: string }[]>`
        SELECT id FROM agent_account WHERE tenant_id = ${tenantId} AND code = ${params.code} AND id <> ${agentAccountId}`;
      if (dup) return { ok: false, reason: "code_taken" };
    }
    if (params.assignedStaffUserId !== undefined && params.assignedStaffUserId !== null
      && !(await isActiveStaffMember(tx, tenantId, params.assignedStaffUserId)))
      return { ok: false, reason: "invalid_staff" };

    const [before] = (params.creditLimit !== undefined || params.autoApproveLimit !== undefined)
      ? await tx<{ creditLimit: string | null; autoApproveLimit: string | null }[]>`
          SELECT credit_limit AS "creditLimit", auto_approve_limit AS "autoApproveLimit"
          FROM agent_account WHERE tenant_id = ${tenantId} AND id = ${agentAccountId}`
      : [];

    // هفت UPDATEِ جداگانه، نه یک CASE WHEN: priceListId/creditLimit/autoApproveLimit/
    // assignedStaffUserId باید بشود صریحاً به NULL برگرداند (مثلاً «ارثِ سقفِ کارخانه»
    // یا «فعلاً پشتیبانِ ثابت ندارد»)، یعنی COALESCE اینجا غلط است — نبودِ کلید را
    // از NULLِ صریح جدا نگه می‌داریم.
    if (params.legalName !== undefined)
      await tx`UPDATE agent_account SET legal_name = ${params.legalName} WHERE tenant_id = ${tenantId} AND id = ${agentAccountId}`;
    if (params.code !== undefined)
      await tx`UPDATE agent_account SET code = ${params.code} WHERE tenant_id = ${tenantId} AND id = ${agentAccountId}`;
    if (params.priceListId !== undefined)
      await tx`UPDATE agent_account SET price_list_id = ${params.priceListId}::uuid WHERE tenant_id = ${tenantId} AND id = ${agentAccountId}`;
    if (params.creditLimit !== undefined)
      await tx`UPDATE agent_account SET credit_limit = ${params.creditLimit}::bigint WHERE tenant_id = ${tenantId} AND id = ${agentAccountId}`;
    if (params.autoApproveLimit !== undefined)
      await tx`UPDATE agent_account SET auto_approve_limit = ${params.autoApproveLimit}::bigint WHERE tenant_id = ${tenantId} AND id = ${agentAccountId}`;
    if (params.assignedStaffUserId !== undefined)
      await tx`UPDATE agent_account SET assigned_staff_user_id = ${params.assignedStaffUserId}::uuid WHERE tenant_id = ${tenantId} AND id = ${agentAccountId}`;
    if (params.isActive !== undefined)
      await tx`UPDATE agent_account SET is_active = ${params.isActive} WHERE tenant_id = ${tenantId} AND id = ${agentAccountId}`;

    const oldDiff: Record<string, AuditValue> = {}, newDiff: Record<string, AuditValue> = {};
    if (before && params.creditLimit !== undefined) {
      const beforeVal = before.creditLimit === null ? null : Number(before.creditLimit);
      if (beforeVal !== params.creditLimit) { oldDiff.creditLimit = beforeVal; newDiff.creditLimit = params.creditLimit; }
    }
    if (before && params.autoApproveLimit !== undefined) {
      const beforeVal = before.autoApproveLimit === null ? null : Number(before.autoApproveLimit);
      if (beforeVal !== params.autoApproveLimit) { oldDiff.autoApproveLimit = beforeVal; newDiff.autoApproveLimit = params.autoApproveLimit; }
    }
    if (Object.keys(newDiff).length)
      await writeAudit(tx, {
        tenantId, actorUserId: params.actorUserId, action: "auto_approve_limit.agent",
        entity: "agent_account", entityId: agentAccountId, oldValue: oldDiff, newValue: newDiff,
      });

    return { ok: true };
  });
}

export type AddAgentUserResult =
  | { ok: true; created: boolean; tempPassword: string | null }
  | { ok: false; reason: "email_taken" | "already_linked" };

/** افزودنِ کاربرِ دیگر به یک نمایندگیِ موجود (وقتی یک نفر کافی نیست). */
export async function addAgentUser(params: {
  tenantId: string; agentAccountId: string; phone: string; email?: string | null;
}): Promise<AddAgentUserResult> {
  const { tenantId, agentAccountId, phone } = params;
  const email = params.email?.trim() || null;

  return withTenant(tenantId, async (tx) => {
    const [agent] = await tx<{ legal_name: string }[]>`
      SELECT legal_name FROM agent_account WHERE tenant_id = ${tenantId} AND id = ${agentAccountId}`;
    const [tenant] = await tx<{ name: string }[]>`SELECT name FROM tenant WHERE id = ${tenantId}`;

    const found = await findOrCreateUser(tx, phone, email);
    if (!found.ok) return found;
    const { userId, created, tempPassword } = found;

    const [linked] = await tx<{ id: string }[]>`
      SELECT id FROM agent_account_user WHERE agent_account_id = ${agentAccountId} AND user_id = ${userId}`;
    if (linked) return { ok: false, reason: "already_linked" };

    const [member] = await tx<{ id: string; is_active: boolean }[]>`
      SELECT id, is_active FROM tenant_membership WHERE tenant_id = ${tenantId} AND user_id = ${userId}`;
    if (member) {
      if (!member.is_active) await tx`UPDATE tenant_membership SET is_active = true WHERE id = ${member.id}`;
    } else {
      await tx`INSERT INTO tenant_membership (tenant_id, user_id, role, is_active) VALUES (${tenantId}, ${userId}, 'agent', true)`;
    }
    await tx`
      INSERT INTO agent_account_user (tenant_id, agent_account_id, user_id, role)
      VALUES (${tenantId}, ${agentAccountId}, ${userId}, 'op')`;

    const payload = created
      ? { type: "agent_invite", tenantName: tenant.name, agentName: agent.legal_name, identifier: phone, tempPassword }
      : { type: "agent_invite", tenantName: tenant.name, agentName: agent.legal_name, identifier: phone, tempPassword: "— با رمزِ فعلیِ خود وارد شوید —" };
    await tx`
      INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
      VALUES (${tenantId}, 'sms', ${phone}, ${JSON.stringify(payload)}::jsonb)`;
    if (email)
      await tx`
        INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
        VALUES (${tenantId}, 'email', ${email}, ${JSON.stringify(payload)}::jsonb)`;

    return { ok: true, created, tempPassword };
  });
}

export type DeleteAgentResult = { ok: true } | { ok: false; reason: "has_history" };

/**
 * حذفِ واقعیِ نمایندگی — فقط اگر هیچ سابقه‌ای ندارد. جدول‌های زیادی به
 * agent_account FK دارند (رزرو، سفارش، حواله، مشتری، override قیمت، صف
 * انتظار، هشدارِ موجودی) و هیچ‌کدام CASCADE نیستند؛ حذفِ نمایندگیِ فعال یعنی
 * پاک‌شدنِ تاریخچه‌ی مالی/سفارش، پس فقط برای نمایندگیِ کاملاً نو مجاز است.
 * agent_account_user «سابقه» نیست (فقط لینکِ کاربر)، پس همین‌جا پاک می‌شود.
 */
export async function deleteAgent(params: { tenantId: string; agentAccountId: string }): Promise<DeleteAgentResult> {
  const { tenantId, agentAccountId } = params;
  return withTenant(tenantId, async (tx) => {
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT (
        (SELECT count(*) FROM reservation WHERE tenant_id = ${tenantId} AND agent_account_id = ${agentAccountId}) +
        (SELECT count(*) FROM sales_request WHERE tenant_id = ${tenantId} AND agent_account_id = ${agentAccountId}) +
        (SELECT count(*) FROM sales_dispatch WHERE tenant_id = ${tenantId} AND agent_account_id = ${agentAccountId}) +
        (SELECT count(*) FROM customer WHERE tenant_id = ${tenantId} AND agent_account_id = ${agentAccountId}) +
        (SELECT count(*) FROM agent_price_override WHERE tenant_id = ${tenantId} AND agent_account_id = ${agentAccountId}) +
        (SELECT count(*) FROM waitlist_entry WHERE tenant_id = ${tenantId} AND agent_account_id = ${agentAccountId}) +
        (SELECT count(*) FROM stock_alert WHERE tenant_id = ${tenantId} AND agent_account_id = ${agentAccountId})
      )::int AS n`;
    if (n > 0) return { ok: false, reason: "has_history" };

    await tx`DELETE FROM agent_account_user WHERE tenant_id = ${tenantId} AND agent_account_id = ${agentAccountId}`;
    await tx`DELETE FROM agent_account WHERE tenant_id = ${tenantId} AND id = ${agentAccountId}`;
    return { ok: true };
  });
}
