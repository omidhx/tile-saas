import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeAgent, AuthzError } from "@/auth/authz";
import { joinWaitlist, leaveWaitlist, listMyWaitlist } from "@/db/waitlist";

/** صف انتظار (v2). نماینده فقط روی نمایندگیِ خودش — authorizeAgent همان chokepoint IDOR. */

async function ctxOf(req: Request, body?: { tenantId?: unknown; agentAccountId?: unknown }) {
  const userId = await currentUserId();
  if (!userId) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };

  const u = new URL(req.url);
  const tenantId = (body?.tenantId ?? u.searchParams.get("tenantId") ?? "") as string;
  const agentAccountId = (body?.agentAccountId ?? u.searchParams.get("agentAccountId") ?? "") as string;
  if (typeof tenantId !== "string" || typeof agentAccountId !== "string" || !tenantId || !agentAccountId)
    return { error: NextResponse.json({ error: "invalid body" }, { status: 400 }) };

  try {
    return { ctx: await authorizeAgent(userId, tenantId, agentAccountId) };
  } catch (e) {
    if (e instanceof AuthzError) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    throw e;
  }
}

export async function GET(req: Request) {
  const { ctx, error } = await ctxOf(req);
  if (error) return error;
  return NextResponse.json({
    entries: await listMyWaitlist({ tenantId: ctx!.tenantId, agentAccountId: ctx!.agentAccountId }),
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { ctx, error } = await ctxOf(req, body);
  if (error) return error;

  const { variantId, quantityBoxes } = body ?? {};
  if (typeof variantId !== "string" || !Number.isInteger(quantityBoxes) || quantityBoxes <= 0)
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  await joinWaitlist({ tenantId: ctx!.tenantId, agentAccountId: ctx!.agentAccountId, variantId, quantityBoxes });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { ctx, error } = await ctxOf(req, body);
  if (error) return error;

  const { variantId } = body ?? {};
  if (typeof variantId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  await leaveWaitlist({ tenantId: ctx!.tenantId, agentAccountId: ctx!.agentAccountId, variantId });
  return NextResponse.json({ ok: true });
}
