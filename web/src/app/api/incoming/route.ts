import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaffPage, AuthzError } from "@/auth/authz";
import { listIncoming, addIncoming, markArrived, setIncomingStatus } from "@/db/incoming";

/** محموله‌های در راه را کارخانه ثبت می‌کند — staff-only. */
async function staffCtx(tenantId: unknown) {
  const userId = await currentUserId();
  if (!userId) return { err: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  if (typeof tenantId !== "string") return { err: NextResponse.json({ error: "invalid" }, { status: 400 }) };
  try {
    await authorizeStaffPage(userId, tenantId, "incoming");
  } catch (e) {
    if (e instanceof AuthzError) return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    throw e;
  }
  return { tenantId, userId };
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await staffCtx(u.searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const includeDone = u.searchParams.get("all") === "1";
  return NextResponse.json({ items: await listIncoming(c.tenantId, { includeDone }) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { variantId, warehouseId, quantityBoxes, expectedAt, source, note } = body ?? {};
  if (typeof variantId !== "string" || typeof warehouseId !== "string"
      || !Number.isInteger(quantityBoxes) || quantityBoxes <= 0
      || typeof expectedAt !== "string" || Number.isNaN(Date.parse(expectedAt)))
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  await addIncoming({
    tenantId: c.tenantId, variantId, warehouseId, quantityBoxes, expectedAt,
    source: typeof source === "string" ? source : undefined,
    note: typeof note === "string" && note.trim() ? note.trim() : null,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** PATCH {id, action:"arrive"|"confirm"|"cancel"} */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { id, action, batchNumber } = body ?? {};
  if (typeof id !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });

  if (action === "arrive") {
    const r = await markArrived({
      tenantId: c.tenantId, id, actorUserId: c.userId,
      batchNumber: typeof batchNumber === "string" && batchNumber.trim() ? batchNumber.trim() : null,
    });
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "not_found" ? 404 : 409 });
    // offers/notified برگردانده می‌شوند تا پشتیبان بداند رسیدنِ محموله چه اثری داشت
    return NextResponse.json({ ok: true, offers: r.offers, notified: r.notified });
  }

  if (action === "confirm" || action === "cancel") {
    await setIncomingStatus({ tenantId: c.tenantId, id, status: action === "confirm" ? "confirmed" : "cancelled" });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "invalid" }, { status: 400 });
}
