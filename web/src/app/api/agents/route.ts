import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { staffCtx as authStaffCtx, adminCtx } from "@/auth/httpCtx";
import { listAgentsFull, createAgent, updateAgent, addAgentUser, deleteAgent } from "@/db/agents";
import { listStaffOptions } from "@/db/team";

/**
 * GET /api/agents?tenantId — نمایندگی‌های فعالِ tenant (برای فرم backorderِ staff، حداقلِ لازم).
 * GET /api/agents?tenantId&detail=1 — فهرستِ کامل با کاربران/قیمت/سقف، برای صفحه‌ی مدیریت. admin-only.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId");
  const detail = url.searchParams.get("detail") === "1";

  if (detail) {
    const c = await adminCtx(tenantId);
    if ("err" in c) return c.err;
    const [agents, staffOptions] = await Promise.all([listAgentsFull(c.tenantId), listStaffOptions(c.tenantId)]);
    return NextResponse.json({ agents, staffOptions });
  }

  const c = await authStaffCtx(tenantId);
  if ("err" in c) return c.err;
  const agents = await withTenant(c.tenantId, (tx) =>
    tx`SELECT id, legal_name AS "legalName" FROM agent_account
       WHERE tenant_id = ${c.tenantId} AND is_active ORDER BY legal_name`,
  );
  return NextResponse.json({ agents });
}

/** POST /api/agents — نمایندگیِ تازه + کاربرِ اولش. admin-only. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, legalName, code, priceListId, creditLimit, autoApproveLimit, assignedStaffUserId, firstUserPhone, firstUserEmail } = body ?? {};
  if (typeof legalName !== "string" || !legalName.trim()
    || typeof code !== "string" || !code.trim() || typeof firstUserPhone !== "string" || !firstUserPhone.trim())
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await adminCtx(tenantId);
  if ("err" in auth) return auth.err;

  const r = await createAgent({
    tenantId, legalName: legalName.trim(), code: code.trim(),
    priceListId: priceListId ?? null, creditLimit: creditLimit ?? null, autoApproveLimit: autoApproveLimit ?? null,
    assignedStaffUserId: assignedStaffUserId ?? null,
    firstUserPhone: firstUserPhone.trim(), firstUserEmail,
  });
  if (!r.ok) {
    const status = r.reason === "seat_limit" ? 403 : r.reason === "invalid_limit" ? 400 : 409;
    return NextResponse.json({ error: r.reason }, { status });
  }
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
  if (typeof agentAccountId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await adminCtx(tenantId);
  if ("err" in auth) return auth.err;

  if (addUser) {
    if (typeof addUser.phone !== "string" || !addUser.phone.trim())
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const r = await addAgentUser({ tenantId, agentAccountId, phone: addUser.phone.trim(), email: addUser.email });
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
    return NextResponse.json({ ok: true, created: r.created, tempPassword: r.tempPassword });
  }

  const { legalName, code, priceListId, creditLimit, autoApproveLimit, isActive, assignedStaffUserId } = body;
  const r = await updateAgent({
    tenantId, agentAccountId, actorUserId: auth.userId,
    legalName, code, priceListId, creditLimit, autoApproveLimit, isActive, assignedStaffUserId,
  });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "invalid_limit" ? 400 : 409 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/agents — حذفِ واقعی، فقط اگر نمایندگی هیچ سابقه‌ای ندارد. admin-only. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, agentAccountId } = body ?? {};
  if (typeof agentAccountId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await adminCtx(tenantId);
  if ("err" in auth) return auth.err;

  const r = await deleteAgent({ tenantId, agentAccountId });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
