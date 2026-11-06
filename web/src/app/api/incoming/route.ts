import { NextResponse } from "next/server";
import { z } from "zod";
import { id, positive, parse } from "@/lib/validate";
import { staffCtx } from "@/auth/httpCtx";
import { listIncoming, addIncoming, markArrived, setIncomingStatus } from "@/db/incoming";

const Add = z.object({
  variantId: id, warehouseId: id,
  quantityBoxes: positive.max(2_147_483_647), // ستونِ INT
  expectedAt: z.iso.date(),
  source: z.enum(["production", "transfer", "purchase"]).optional(),
  note: z.string().nullish(),
});
const Patch = z.object({
  id, action: z.enum(["arrive", "confirm", "cancel"]), batchNumber: z.string().nullish(),
});

export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await staffCtx(u.searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const includeDone = u.searchParams.get("all") === "1";
  return NextResponse.json({ items: await listIncoming(c.tenantId, { includeDone }) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Add, body);
  if ("err" in p) return p.err;
  const { variantId, warehouseId, quantityBoxes, expectedAt, source, note } = p.data;

  await addIncoming({
    tenantId: c.tenantId, variantId, warehouseId, quantityBoxes, expectedAt, source,
    note: note?.trim() || null,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** PATCH {id, action:"arrive"|"confirm"|"cancel"} */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Patch, body);
  if ("err" in p) return p.err;
  const { id: incomingId, action, batchNumber } = p.data;

  if (action === "arrive") {
    const r = await markArrived({
      tenantId: c.tenantId, id: incomingId, actorUserId: c.userId,
      batchNumber: batchNumber?.trim() || null,
    });
    if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "not_found" ? 404 : 409 });
    // notified برگردانده می‌شود تا پشتیبان بداند رسیدنِ محموله چه اثری داشت
    return NextResponse.json({ ok: true, notified: r.notified });
  }

  await setIncomingStatus({ tenantId: c.tenantId, id: incomingId, status: action === "confirm" ? "confirmed" : "cancelled" });
  return NextResponse.json({ ok: true });
}
