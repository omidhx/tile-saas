import { NextResponse } from "next/server";
import { z } from "zod";
import { id, positive, parse } from "@/lib/validate";
import { staffCtx, featureOff } from "@/auth/httpCtx";
import { createVolumeDiscount, updateVolumeDiscount, deleteVolumeDiscount } from "@/db/pricing";

// minQtyBoxes ستونِ INT است؛ percentOff در CHECK (۱..۱۰۰)
const tier = { minQtyBoxes: positive.max(2_147_483_647), percentOff: positive.max(100) };
const Create = z.object({ priceListId: id.nullable(), variantId: id.nullable(), ...tier });
const Update = z.object({ id, ...tier });
const Remove = z.object({ id });

const statusFor = (reason: string) => (reason === "not_found" ? 404 : reason === "duplicate" ? 409 : 400);

/** POST {tenantId, priceListId, variantId, minQtyBoxes, percentOff} — priceListId/variantId می‌توانند null باشند (یعنی «همه»). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "volume_discount");
  if (off) return off;

  const p = parse(Create, body);
  if ("err" in p) return p.err;

  const result = await createVolumeDiscount({ tenantId: c.tenantId, ...p.data });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: statusFor(result.reason) });
  return NextResponse.json({ id: result.id }, { status: 201 });
}

/** PATCH {tenantId, id, minQtyBoxes, percentOff} — فقط حداقل/درصد؛ سبد/کالا ثابت می‌مانند. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "volume_discount");
  if (off) return off;

  const p = parse(Update, body);
  if ("err" in p) return p.err;

  const result = await updateVolumeDiscount({ tenantId: c.tenantId, ...p.data });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: statusFor(result.reason) });
  return NextResponse.json({ ok: true });
}

/** DELETE {tenantId, id} */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "volume_discount");
  if (off) return off;
  const p = parse(Remove, body);
  if ("err" in p) return p.err;

  const result = await deleteVolumeDiscount({ tenantId: c.tenantId, id: p.data.id });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
  return NextResponse.json({ ok: true });
}
