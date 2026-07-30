import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaffPage, AuthzError } from "@/auth/authz";
import { createVolumeDiscount, updateVolumeDiscount, deleteVolumeDiscount } from "@/db/pricing";

/** context مشترک: staff-only، همان pageKey=«prices» — پله‌ی تخفیف بخشی از قیمت‌گذاری است. */
async function staffCtx(tenantId: unknown) {
  const userId = await currentUserId();
  if (!userId) return { err: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  if (typeof tenantId !== "string") return { err: NextResponse.json({ error: "invalid" }, { status: 400 }) };
  try {
    await authorizeStaffPage(userId, tenantId, "prices");
  } catch (e) {
    if (e instanceof AuthzError) return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    throw e;
  }
  return { tenantId };
}

const statusFor = (reason: string) => (reason === "not_found" ? 404 : reason === "duplicate" ? 409 : 400);

/** POST {tenantId, priceListId, variantId, minQtyBoxes, percentOff} — priceListId/variantId می‌توانند null باشند (یعنی «همه»). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { priceListId, variantId, minQtyBoxes, percentOff } = body ?? {};
  if ((priceListId !== null && typeof priceListId !== "string")
      || (variantId !== null && typeof variantId !== "string")
      || typeof minQtyBoxes !== "number" || typeof percentOff !== "number")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await createVolumeDiscount({ tenantId: c.tenantId, priceListId, variantId, minQtyBoxes, percentOff });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: statusFor(result.reason) });
  return NextResponse.json({ id: result.id }, { status: 201 });
}

/** PATCH {tenantId, id, minQtyBoxes, percentOff} — فقط حداقل/درصد؛ سبد/کالا ثابت می‌مانند. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { id, minQtyBoxes, percentOff } = body ?? {};
  if (typeof id !== "string" || typeof minQtyBoxes !== "number" || typeof percentOff !== "number")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await updateVolumeDiscount({ tenantId: c.tenantId, id, minQtyBoxes, percentOff });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: statusFor(result.reason) });
  return NextResponse.json({ ok: true });
}

/** DELETE {tenantId, id} */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  if (typeof body?.id !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await deleteVolumeDiscount({ tenantId: c.tenantId, id: body.id });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
  return NextResponse.json({ ok: true });
}
