import { NextResponse } from "next/server";
import { z } from "zod";
import { id, count, isId, parse } from "@/lib/validate";
import { adminCtx, featureOff } from "@/auth/httpCtx";
import { listAgentOverrides, createAgentOverride, updateAgentOverride, deleteAgentOverride } from "@/db/pricing";

// تاریخِ ISO (YYYY-MM-DD)؛ خراب‌بودنش نباید به ::date در Postgres برسد (22007 → ۵۰۰).
const date = z.iso.date().nullish();
const Create = z.object({ agentAccountId: id, variantId: id, price: count, validFrom: date, validTo: date });
const Update = z.object({ id, price: count, validFrom: date, validTo: date });
const Remove = z.object({ id });

const statusFor = (reason: string) => (reason === "not_found" ? 404 : reason === "overlap" ? 409 : 400);

/** GET ?tenantId&agentAccountId — استثناهای قیمتِ یک نماینده. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await adminCtx(u.searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "agent_price");
  if (off) return off;
  const agentAccountId = u.searchParams.get("agentAccountId");
  if (!isId(agentAccountId)) return NextResponse.json({ error: "invalid" }, { status: 400 });
  return NextResponse.json({ overrides: await listAgentOverrides(c.tenantId, agentAccountId) });
}

/** POST {tenantId, agentAccountId, variantId, price, validFrom, validTo} — validFrom/validTo اختیاری (null=نامحدود). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "agent_price");
  if (off) return off;

  const p = parse(Create, body);
  if ("err" in p) return p.err;
  const { agentAccountId, variantId, price, validFrom, validTo } = p.data;

  const result = await createAgentOverride({
    tenantId: c.tenantId, agentAccountId, variantId, price,
    validFrom: validFrom ?? null, validTo: validTo ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: statusFor(result.reason) });
  return NextResponse.json({ id: result.id }, { status: 201 });
}

/** PATCH {tenantId, id, price, validFrom, validTo} — فقط قیمت/بازه؛ نماینده/کالا ثابت می‌مانند. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "agent_price");
  if (off) return off;

  const p = parse(Update, body);
  if ("err" in p) return p.err;
  const { id: overrideId, price, validFrom, validTo } = p.data;

  const result = await updateAgentOverride({ tenantId: c.tenantId, id: overrideId, price, validFrom: validFrom ?? null, validTo: validTo ?? null });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: statusFor(result.reason) });
  return NextResponse.json({ ok: true });
}

/** DELETE {tenantId, id} */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "agent_price");
  if (off) return off;
  const p = parse(Remove, body);
  if ("err" in p) return p.err;

  const result = await deleteAgentOverride({ tenantId: c.tenantId, id: p.data.id });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
  return NextResponse.json({ ok: true });
}
