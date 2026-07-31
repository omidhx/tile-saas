import { NextResponse } from "next/server";
import { staffPageCtx } from "@/auth/httpCtx";
import { addProductImage, removeProductImage, setPrimaryImage } from "@/db/products";

// گالریِ تصاویرِ محصول را پشتیبان مدیریت می‌کند — staff-only.
const staffCtx = (tenantId: unknown) => staffPageCtx(tenantId, "catalog");

/** POST — افزودنِ عکس به گالریِ یک محصول. { productId, url } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  if (typeof body?.productId !== "string" || typeof body?.url !== "string" || !body.url.trim())
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  await addProductImage({ tenantId: c.tenantId, productId: body.productId, url: body.url });
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** PATCH — «اصلی»‌کردنِ یک عکس. { imageId } */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  if (typeof body?.imageId !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });
  await setPrimaryImage({ tenantId: c.tenantId, imageId: body.imageId });
  return NextResponse.json({ ok: true });
}

/** DELETE — حذفِ یک عکس از گالری. { imageId } */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  if (typeof body?.imageId !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });
  await removeProductImage({ tenantId: c.tenantId, imageId: body.imageId });
  return NextResponse.json({ ok: true });
}
