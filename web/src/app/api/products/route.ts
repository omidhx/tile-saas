import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { listProducts, setProductImage } from "@/db/products";

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

/** PATCH {tenantId, productId, imageUrl} — تنظیم/حذفِ عکس (null = حذف). */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { productId, imageUrl } = body ?? {};
  if (typeof productId !== "string" || (imageUrl !== null && typeof imageUrl !== "string"))
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  await setProductImage({ tenantId: c.tenantId, productId, imageUrl: imageUrl || null });
  return NextResponse.json({ ok: true });
}
