import { NextResponse } from "next/server";
import { z } from "zod";
import { id, parse } from "@/lib/validate";
import { withTenant } from "@/db/client";
import { staffCtx as authStaffCtx, adminCtx } from "@/auth/httpCtx";
import { listAgentsFull, createAgent, updateAgent, addAgentUser, deleteAgent } from "@/db/agents";
import { listStaffOptions } from "@/db/team";

const name = z.string().trim().min(1);
// سقف را عمداً فقط number می‌گیریم: منفی/اعشار را db/agents.ts با reasonِ «invalid_limit» رد می‌کند.
const limit = z.number().nullish();
const Create = z.object({
  legalName: name, code: name, firstUserPhone: name,
  priceListId: id.nullish(), autoApproveLimit: limit, assignedStaffUserId: id.nullish(),
  firstUserEmail: z.string().nullish(),
});
// priceListId/assignedStaffUserId سه‌حالته‌اند: نبودن=دست‌نزن، null=پاک‌کن، uuid=ست‌کن.
const Update = z.object({
  agentAccountId: id,
  addUser: z.object({ phone: name, email: z.string().nullish() }).nullish(),
  legalName: z.string().optional(), code: z.string().optional(),
  priceListId: id.nullish(), assignedStaffUserId: id.nullish(),
  autoApproveLimit: limit, isActive: z.boolean().optional(),
});
const Remove = z.object({ agentAccountId: id });

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
  const body = await req.json().catch(() => null);
  const auth = await adminCtx(body?.tenantId);
  if ("err" in auth) return auth.err;
  const p = parse(Create, body);
  if ("err" in p) return p.err;
  const d = p.data;

  const r = await createAgent({
    tenantId: auth.tenantId, legalName: d.legalName, code: d.code,
    priceListId: d.priceListId ?? null, autoApproveLimit: d.autoApproveLimit ?? null,
    assignedStaffUserId: d.assignedStaffUserId ?? null,
    firstUserPhone: d.firstUserPhone, firstUserEmail: d.firstUserEmail,
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
  const body = await req.json().catch(() => null);
  const auth = await adminCtx(body?.tenantId);
  if ("err" in auth) return auth.err;
  const p = parse(Update, body);
  if ("err" in p) return p.err;
  const { agentAccountId, addUser, ...f } = p.data;
  const tenantId = auth.tenantId;

  if (addUser) {
    const r = await addAgentUser({ tenantId, agentAccountId, phone: addUser.phone, email: addUser.email });
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
    return NextResponse.json({ ok: true, created: r.created, tempPassword: r.tempPassword });
  }

  const r = await updateAgent({ tenantId, agentAccountId, actorUserId: auth.userId, ...f });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "invalid_limit" ? 400 : 409 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/agents — حذفِ واقعی، فقط اگر نمایندگی هیچ سابقه‌ای ندارد. admin-only. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const auth = await adminCtx(body?.tenantId);
  if ("err" in auth) return auth.err;
  const p = parse(Remove, body);
  if ("err" in p) return p.err;

  const r = await deleteAgent({ tenantId: auth.tenantId, agentAccountId: p.data.agentAccountId });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
