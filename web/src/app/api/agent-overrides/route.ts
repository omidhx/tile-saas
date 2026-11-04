import { NextResponse } from "next/server";
import { adminCtx } from "@/auth/httpCtx";
import { listAgentOverrides, createAgentOverride, updateAgentOverride, deleteAgentOverride } from "@/db/pricing";

const statusFor = (reason: string) => (reason === "not_found" ? 404 : reason === "overlap" ? 409 : 400);

/** GET ?tenantId&agentAccountId — استثناهای قیمتِ یک نماینده. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await adminCtx(u.searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const agentAccountId = u.searchParams.get("agentAccountId");
  if (typeof agentAccountId !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });
  return NextResponse.json({ overrides: await listAgentOverrides(c.tenantId, agentAccountId) });
}

/** POST {tenantId, agentAccountId, variantId, price, validFrom, validTo} — validFrom/validTo اختیاری (null=نامحدود). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { agentAccountId, variantId, price, validFrom, validTo } = body ?? {};
  if (typeof agentAccountId !== "string" || typeof variantId !== "string" || typeof price !== "number"
      || (validFrom !== null && typeof validFrom !== "string") || (validTo !== null && typeof validTo !== "string"))
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await createAgentOverride({
    tenantId: c.tenantId, agentAccountId, variantId, price,
    validFrom: validFrom ?? null, validTo: validTo ?? null,
  });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: statusFor(result.reason) });
  return NextResponse.json({ id: result.id }, { status: 201 });
}

/** PATCH {tenantId, id, price, validFrom, validTo} — فقط قیمت/بازه؛ نماینده/کالا ثابت می‌مانند. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { id, price, validFrom, validTo } = body ?? {};
  if (typeof id !== "string" || typeof price !== "number"
      || (validFrom !== null && typeof validFrom !== "string") || (validTo !== null && typeof validTo !== "string"))
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await updateAgentOverride({ tenantId: c.tenantId, id, price, validFrom: validFrom ?? null, validTo: validTo ?? null });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: statusFor(result.reason) });
  return NextResponse.json({ ok: true });
}

/** DELETE {tenantId, id} */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;
  if (typeof body?.id !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await deleteAgentOverride({ tenantId: c.tenantId, id: body.id });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
  return NextResponse.json({ ok: true });
}
