import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, authorizeAdmin, AuthzError } from "@/auth/authz";
import { listAgentsFull, createAgent, updateAgent, addAgentUser, deleteAgent } from "@/db/agents";

/**
 * GET /api/agents?tenantId — نمایندگی‌های فعالِ tenant (برای فرم backorderِ staff، حداقلِ لازم).
 * GET /api/agents?tenantId&detail=1 — فهرستِ کامل با کاربران/قیمت/سقف، برای صفحه‌ی مدیریت. admin-only.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const detail = url.searchParams.get("detail") === "1";

  if (detail) {
    try {
      await authorizeAdmin(userId, tenantId);
    } catch (e) {
      if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
      throw e;
    }
    return NextResponse.json({ agents: await listAgentsFull(tenantId) });
  }

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

async function requireAdmin(tenantId: string) {
  const userId = await currentUserId();
  if (!userId) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  try {
    await authorizeAdmin(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    throw e;
  }
  return { userId };
}

/** POST /api/agents — نمایندگیِ تازه + کاربرِ اولش. admin-only. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, legalName, code, priceListId, creditLimit, autoApproveLimit, firstUserPhone, firstUserEmail } = body ?? {};
  if (typeof tenantId !== "string" || typeof legalName !== "string" || !legalName.trim()
    || typeof code !== "string" || !code.trim() || typeof firstUserPhone !== "string" || !firstUserPhone.trim())
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await requireAdmin(tenantId);
  if (auth.error) return auth.error;

  const r = await createAgent({
    tenantId, legalName: legalName.trim(), code: code.trim(),
    priceListId: priceListId ?? null, creditLimit: creditLimit ?? null, autoApproveLimit: autoApproveLimit ?? null,
    firstUserPhone: firstUserPhone.trim(), firstUserEmail,
  });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "seat_limit" ? 403 : 409 });
  return NextResponse.json({ ok: true, agentAccountId: r.agentAccountId, tempPassword: r.tempPassword }, { status: 201 });
}

/**
 * PATCH /api/agents — دو شکل بر اساس body:
 *   • { agentAccountId, ...fields }        → ویرایشِ نمایندگی
 *   • { agentAccountId, addUser: {phone, email?} } → افزودنِ کاربرِ دیگر
 * admin-only.
 */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, agentAccountId, addUser } = body ?? {};
  if (typeof tenantId !== "string" || typeof agentAccountId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await requireAdmin(tenantId);
  if (auth.error) return auth.error;

  if (addUser) {
    if (typeof addUser.phone !== "string" || !addUser.phone.trim())
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const r = await addAgentUser({ tenantId, agentAccountId, phone: addUser.phone.trim(), email: addUser.email });
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
    return NextResponse.json({ ok: true, created: r.created, tempPassword: r.tempPassword });
  }

  const { legalName, code, priceListId, creditLimit, autoApproveLimit, isActive } = body;
  const r = await updateAgent({ tenantId, agentAccountId, legalName, code, priceListId, creditLimit, autoApproveLimit, isActive });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/agents — حذفِ واقعی، فقط اگر نمایندگی هیچ سابقه‌ای ندارد. admin-only. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, agentAccountId } = body ?? {};
  if (typeof tenantId !== "string" || typeof agentAccountId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await requireAdmin(tenantId);
  if (auth.error) return auth.error;

  const r = await deleteAgent({ tenantId, agentAccountId });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
