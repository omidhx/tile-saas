import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { listProducts, createProduct, updateProduct } from "@/db/products";

/** ویژگی‌های اختیاریِ متنی از بدنه؛ رشته یا null (خالی → null در لایه‌ی db). */
const optStr = (v: unknown) => (v === undefined ? undefined : typeof v === "string" ? v : null);

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

  const { name, code, sku, color, glaze, punch, body: bodyType } = body ?? {};
  if (typeof name !== "string" || typeof code !== "string" || typeof sku !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const r = await createProduct(c.tenantId, {
    name, code, sku,
    color: optStr(color) ?? null, glaze: optStr(glaze) ?? null,
    punch: optStr(punch) ?? null, body: optStr(bodyType) ?? null,
    size: optStr(body?.size) ?? null, thickness: optStr(body?.thickness) ?? null,
    usageArea: optStr(body?.usageArea) ?? null, description: optStr(body?.description) ?? null,
    imageUrl: typeof body?.imageUrl === "string" ? body.imageUrl : null,
  });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "missing" ? 400 : 409 });
  return NextResponse.json({ id: r.id }, { status: 201 });
}

/** PATCH — ویرایشِ ویژگی‌های محصول (عکس‌ها از راهِ /api/product-images). */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  if (typeof body?.productId !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });

  await updateProduct({
    tenantId: c.tenantId, productId: body.productId,
    name: typeof body.name === "string" ? body.name : undefined,
    color: optStr(body.color), glaze: optStr(body.glaze), punch: optStr(body.punch), body: optStr(body.body),
    size: optStr(body.size), thickness: optStr(body.thickness),
    usageArea: optStr(body.usageArea), description: optStr(body.description),
  });
  return NextResponse.json({ ok: true });
}
