import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { listProducts, setProductImage, createProduct, updateProduct } from "@/db/products";

async function staffCtx(tenantId: unknown) {
  const userId = await currentUserId();
  if (!userId) return { err: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  if (typeof tenantId !== "string") return { err: NextResponse.json({ error: "invalid" }, { status: 400 }) };
  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    throw e;
  }
  return { tenantId };
}

/** GET ?tenantId — همه‌ی محصولات + وضعیتِ عکس (پنل کاتالوگ). */
export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  return NextResponse.json({ products: await listProducts(c.tenantId) });
}

/** POST — محصولِ جدید (نام، کد، sku + ویژگی‌ها و عکس اختیاری). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { name, code, sku, color, glaze, punch, body: bodyType, imageUrl } = body ?? {};
  if (typeof name !== "string" || typeof code !== "string" || typeof sku !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const r = await createProduct(c.tenantId, {
    name, code, sku,
    color: typeof color === "string" ? color : null,
    glaze: typeof glaze === "string" ? glaze : null,
    punch: typeof punch === "string" ? punch : null,
    body: typeof bodyType === "string" ? bodyType : null,
    imageUrl: typeof imageUrl === "string" ? imageUrl : null,
  });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "missing" ? 400 : 409 });
  return NextResponse.json({ id: r.id }, { status: 201 });
}

/**
 * PATCH — دو کار بسته به body:
 *   { productId, imageUrl }              → تنظیم/حذفِ عکس (null = حذف)
 *   { productId, name/color/glaze/... }  → ویرایشِ ویژگی‌ها
 */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  if (typeof body?.productId !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });

  // فقط عکس؟ (imageUrl صریح آمده، حتی اگر null)
  if ("imageUrl" in body && !("name" in body || "color" in body || "glaze" in body || "punch" in body || "body" in body)) {
    if (body.imageUrl !== null && typeof body.imageUrl !== "string")
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    await setProductImage({ tenantId: c.tenantId, productId: body.productId, imageUrl: body.imageUrl || null });
    return NextResponse.json({ ok: true });
  }

  await updateProduct({
    tenantId: c.tenantId, productId: body.productId,
    name: typeof body.name === "string" ? body.name : undefined,
    color: body.color === undefined ? undefined : (typeof body.color === "string" ? body.color : null),
    glaze: body.glaze === undefined ? undefined : (typeof body.glaze === "string" ? body.glaze : null),
    punch: body.punch === undefined ? undefined : (typeof body.punch === "string" ? body.punch : null),
    body: body.body === undefined ? undefined : (typeof body.body === "string" ? body.body : null),
  });
  return NextResponse.json({ ok: true });
}
