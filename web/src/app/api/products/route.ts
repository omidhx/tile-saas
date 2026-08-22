import { NextResponse } from "next/server";
import { staffPageCtx } from "@/auth/httpCtx";
import { listProducts, createProduct, updateProduct } from "@/db/products";
import { isSafeImageUrl } from "@/lib/url";

/** ویژگی‌های اختیاریِ متنی از بدنه؛ رشته یا null (خالی → null در لایه‌ی db). */
const optStr = (v: unknown) => (v === undefined ? undefined : typeof v === "string" ? v : null);

/**
 * عددِ صحیحِ مثبتِ اختیاری (بسته‌بندی): undefined=دست‌نزن، null/""=پاک‌کن، وگرنه
 * باید عددِ صحیحِ مثبت باشد — چون CHECK(> 0) در schema هست و رد نکردنش اینجا
 * یعنی خطای خامِ SQL به‌جای پیامِ روشن.
 */
function optPosInt(v: unknown): { ok: true; value: number | null | undefined } | { ok: false } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null || v === "") return { ok: true, value: null };
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? { ok: true, value: n } : { ok: false };
}

const staffCtx = (tenantId: unknown) => staffPageCtx(tenantId, "catalog");

/** GET ?tenantId[&q][&offset] — محصولات صفحه‌بندی‌شده + وضعیتِ عکس (پنل کاتالوگ). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const c = await staffCtx(url.searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const { items, hasMore } = await listProducts({
    tenantId: c.tenantId,
    q: url.searchParams.get("q") ?? undefined,
    offset: Number(url.searchParams.get("offset")) || 0,
  });
  return NextResponse.json({ products: items, hasMore });
}

/** POST — محصولِ جدید (نام، کد، sku + ویژگی‌ها و عکس اختیاری). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { name, code, sku, color, glaze, punch, body: bodyType } = body ?? {};
  if (typeof name !== "string" || typeof code !== "string" || typeof sku !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const bpp = optPosInt(body?.boxesPerPallet);
  const spb = optPosInt(body?.sqcmPerBox);
  if (!bpp.ok || !spb.ok) return NextResponse.json({ error: "invalid_packaging" }, { status: 400 });

  // موجودیِ اولیه (اختیاری): یا هر دو (انبار + تعداد) بیایند، یا هیچ‌کدام —
  // نیمه‌کاره (فقط انبار یا فقط تعداد) یعنی فرم را اشتباه پر کرده، نه «بدونِ موجودی».
  const rawStock = body?.initialStock;
  let initialStock: { warehouseId: string; quantityBoxes: number } | undefined;
  if (rawStock != null) {
    const qty = Number(rawStock?.quantityBoxes);
    if (typeof rawStock?.warehouseId !== "string" || !rawStock.warehouseId ||
        !Number.isInteger(qty) || qty <= 0)
      return NextResponse.json({ error: "invalid_stock" }, { status: 400 });
    initialStock = { warehouseId: rawStock.warehouseId, quantityBoxes: qty };
  }

  const r = await createProduct(c.tenantId, {
    name, code, sku,
    color: optStr(color) ?? null, glaze: optStr(glaze) ?? null,
    punch: optStr(punch) ?? null, body: optStr(bodyType) ?? null,
    size: optStr(body?.size) ?? null, thickness: optStr(body?.thickness) ?? null,
    usageArea: optStr(body?.usageArea) ?? null, description: optStr(body?.description) ?? null,
    imageUrl: typeof body?.imageUrl === "string" && isSafeImageUrl(body.imageUrl) ? body.imageUrl : null,
    boxesPerPallet: bpp.value ?? null, sqcmPerBox: spb.value ?? null,
    initialStock,
  }, c.userId);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "missing" || r.reason === "invalid_stock" ? 400 : 409 });
  return NextResponse.json({ id: r.id }, { status: 201 });
}

/** PATCH — ویرایشِ ویژگی‌های محصول (عکس‌ها از راهِ /api/product-images). */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  if (typeof body?.productId !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });

  const bpp = optPosInt(body.boxesPerPallet);
  const spb = optPosInt(body.sqcmPerBox);
  if (!bpp.ok || !spb.ok) return NextResponse.json({ error: "invalid_packaging" }, { status: 400 });

  await updateProduct({
    tenantId: c.tenantId, productId: body.productId, actorUserId: c.userId,
    name: typeof body.name === "string" ? body.name : undefined,
    color: optStr(body.color), glaze: optStr(body.glaze), punch: optStr(body.punch), body: optStr(body.body),
    size: optStr(body.size), thickness: optStr(body.thickness),
    usageArea: optStr(body.usageArea), description: optStr(body.description),
    variantId: typeof body.variantId === "string" ? body.variantId : undefined,
    boxesPerPallet: bpp.value, sqcmPerBox: spb.value,
  });
  return NextResponse.json({ ok: true });
}
