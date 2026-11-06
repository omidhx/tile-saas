import { NextResponse } from "next/server";
import { z } from "zod";
import { id, isId, parse } from "@/lib/validate";
import { staffCtx } from "@/auth/httpCtx";
import { listProducts, createProduct, updateProduct } from "@/db/products";
import { isSafeImageUrl } from "@/lib/url";

/**
 * عددِ صحیحِ مثبتِ اختیاری (بسته‌بندی): undefined=دست‌نزن، null/""=پاک‌کن، وگرنه
 * باید عددِ صحیحِ مثبت باشد — چون CHECK(> 0) در schema هست و رد نکردنش اینجا
 * یعنی خطای خامِ SQL به‌جای پیامِ روشن.
 */
function optPosInt(v: unknown): { ok: true; value: number | null | undefined } | { ok: false } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null || v === "") return { ok: true, value: null };
  const n = Number(v);
  // ≤ حدِ INT (ستونِ INT)؛ بزرگ‌تر 22003 → ۵۰۰ می‌شد
  return Number.isInteger(n) && n > 0 && n <= 2_147_483_647 ? { ok: true, value: n } : { ok: false };
}

// بسته‌بندی (boxesPerPallet/sqcmPerBox) و initialStock عمداً اینجا نیستند: کدِ خطای اختصاصی
// (invalid_packaging / invalid_stock) دارند که UI می‌شناسد، پس دستی چک می‌شوند.
const Str = z.string().nullish();
const Attrs = {
  color: Str, glaze: Str, punch: Str, body: Str, size: Str, thickness: Str, usageArea: Str, description: Str,
};
const Create = z.object({ name: z.string(), code: z.string(), sku: z.string(), ...Attrs });
const Update = z.object({ productId: id, name: z.string().optional(), variantId: id.nullish(), ...Attrs });


/** GET ?tenantId[&q][&offset] — محصولات صفحه‌بندی‌شده + وضعیتِ عکس (پنل کاتالوگ). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const c = await staffCtx(url.searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const { items, hasMore } = await listProducts({
    tenantId: c.tenantId,
    q: url.searchParams.get("q") ?? undefined,
    offset: Math.max(0, Math.trunc(Number(url.searchParams.get("offset"))) || 0),
  });
  return NextResponse.json({ products: items, hasMore });
}

/** POST — محصولِ جدید (نام، کد، sku + ویژگی‌ها و عکس اختیاری). */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const p = parse(Create, body);
  if ("err" in p) return p.err;
  const d = p.data;

  const bpp = optPosInt(body?.boxesPerPallet);
  const spb = optPosInt(body?.sqcmPerBox);
  if (!bpp.ok || !spb.ok) return NextResponse.json({ error: "invalid_packaging" }, { status: 400 });

  // موجودیِ اولیه (اختیاری): یا هر دو (انبار + تعداد) بیایند، یا هیچ‌کدام —
  // نیمه‌کاره (فقط انبار یا فقط تعداد) یعنی فرم را اشتباه پر کرده، نه «بدونِ موجودی».
  const rawStock = body?.initialStock;
  let initialStock: { warehouseId: string; quantityBoxes: number } | undefined;
  if (rawStock != null) {
    const qty = Number(rawStock?.quantityBoxes);
    if (!isId(rawStock?.warehouseId) || !Number.isInteger(qty) || qty <= 0 || qty > 2_147_483_647)
      return NextResponse.json({ error: "invalid_stock" }, { status: 400 });
    initialStock = { warehouseId: rawStock.warehouseId, quantityBoxes: qty };
  }

  const r = await createProduct(c.tenantId, {
    name: d.name, code: d.code, sku: d.sku,
    color: d.color ?? null, glaze: d.glaze ?? null,
    punch: d.punch ?? null, body: d.body ?? null,
    size: d.size ?? null, thickness: d.thickness ?? null,
    usageArea: d.usageArea ?? null, description: d.description ?? null,
    imageUrl: typeof body?.imageUrl === "string" && isSafeImageUrl(body.imageUrl) ? body.imageUrl : null,
    boxesPerPallet: bpp.value ?? null, sqcmPerBox: spb.value ?? null,
    initialStock,
  }, c.userId);
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "missing" || r.reason === "invalid_stock" ? 400 : 409 });
  return NextResponse.json({ id: r.id }, { status: 201 });
}

/** PATCH — ویرایشِ ویژگی‌های محصول (عکس‌ها از راهِ /api/product-images). */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Update, body);
  if ("err" in p) return p.err;
  const d = p.data;

  const bpp = optPosInt(body.boxesPerPallet);
  const spb = optPosInt(body.sqcmPerBox);
  if (!bpp.ok || !spb.ok) return NextResponse.json({ error: "invalid_packaging" }, { status: 400 });

  await updateProduct({
    tenantId: c.tenantId, productId: d.productId, actorUserId: c.userId,
    name: d.name,
    color: d.color, glaze: d.glaze, punch: d.punch, body: d.body,
    size: d.size, thickness: d.thickness,
    usageArea: d.usageArea, description: d.description,
    variantId: d.variantId ?? undefined,
    boxesPerPallet: bpp.value, sqcmPerBox: spb.value,
  });
  return NextResponse.json({ ok: true });
}
