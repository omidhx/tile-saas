import { NextResponse } from "next/server";
import { agentCtx } from "@/auth/httpCtx";
import { joinWaitlist, leaveWaitlist, listMyWaitlist } from "@/db/waitlist";

/** صف انتظار (v2). نماینده فقط روی نمایندگیِ خودش — authorizeAgent همان chokepoint IDOR. */

/** tenantId/agentAccountId یا از query می‌آیند یا از body — این مسیر با هر دو صدا زده می‌شود. */
function ctxOf(req: Request, body?: { tenantId?: unknown; agentAccountId?: unknown }) {
  const u = new URL(req.url);
  const tenantId = body?.tenantId ?? u.searchParams.get("tenantId");
  const agentAccountId = body?.agentAccountId ?? u.searchParams.get("agentAccountId");
  return agentCtx(tenantId, agentAccountId);
}

export async function GET(req: Request) {
  const c = await ctxOf(req);
  if ("err" in c) return c.err;
  return NextResponse.json({
    entries: await listMyWaitlist({ tenantId: c.tenantId, agentAccountId: c.agentAccountId }),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await ctxOf(req, body);
  if ("err" in c) return c.err;

  const { variantId, quantityBoxes } = body ?? {};
  if (typeof variantId !== "string" || !Number.isInteger(quantityBoxes) || quantityBoxes <= 0)
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  await joinWaitlist({ tenantId: c.tenantId, agentAccountId: c.agentAccountId, variantId, quantityBoxes });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await ctxOf(req, body);
  if ("err" in c) return c.err;

  const { variantId } = body ?? {};
  if (typeof variantId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  await leaveWaitlist({ tenantId: c.tenantId, agentAccountId: c.agentAccountId, variantId });
  return NextResponse.json({ ok: true });
}
