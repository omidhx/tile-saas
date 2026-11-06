import { NextResponse } from "next/server";
import { z } from "zod";
import { id, parse } from "@/lib/validate";
import { staffCtx } from "@/auth/httpCtx";
import { addProductImage, removeProductImage, setPrimaryImage } from "@/db/products";
import { isSafeImageUrl } from "@/lib/url";

const Add = z.object({ productId: id, url: z.string().refine((u) => u.trim() !== "" && isSafeImageUrl(u)) });
const Image = z.object({ imageId: id });

// گالریِ تصاویرِ محصول را پشتیبان مدیریت می‌کند — staff-only.

/** POST — افزودنِ عکس به گالریِ یک محصول. { productId, url } */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Add, body);
  if ("err" in p) return p.err;
  await addProductImage({ tenantId: c.tenantId, ...p.data });
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** PATCH — «اصلی»‌کردنِ یک عکس. { imageId } */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Image, body);
  if ("err" in p) return p.err;
  await setPrimaryImage({ tenantId: c.tenantId, imageId: p.data.imageId });
  return NextResponse.json({ ok: true });
}

/** DELETE — حذفِ یک عکس از گالری. { imageId } */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Image, body);
  if ("err" in p) return p.err;
  await removeProductImage({ tenantId: c.tenantId, imageId: p.data.imageId });
  return NextResponse.json({ ok: true });
}
