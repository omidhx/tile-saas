import { withTenant } from "./client";

/**
 * مدیریتِ محصول (v2). محصول اینجا **ساخته** می‌شود — قبلاً فقط seed/SQL دستی بود،
 * که برای production قابل قبول نیست.
 *
 * نکته‌ی ساختاری: محصول برای **قابلِ سفارش شدن** به یک `product_variant` (با `sku`)
 * نیاز دارد. پس ساختِ محصول هم‌زمان یک variant می‌سازد، وگرنه محصولِ بی‌واریانت
 * هرگز در `/reserve` نمی‌آید — یک تله که فرمِ ساده پنهانش می‌کند.
 */

export type ProductRow = {
  id: string; name: string; code: string;
  imageUrl: string | null; color: string | null; glaze: string | null;
  punch: string | null; body: string | null;
  /** sku اولین variant — برای ورودِ موجودیِ اکسل لازم است (تطبیق با همین). */
  sku: string | null;
  /** آیا اصلاً موجودی/lot دارد؟ محصولِ تازه‌ساخته هنوز موجودی ندارد. */
  hasStock: boolean;
};

export function listProducts(tenantId: string) {
  return withTenant(tenantId, (tx) => tx<ProductRow[]>`
    SELECT p.id, p.name, p.code, p.image_url AS "imageUrl",
           p.color, p.glaze, p.punch, p.body,
           (SELECT pv.sku FROM product_variant pv
            WHERE pv.product_id = p.id ORDER BY pv.sku LIMIT 1) AS sku,
           EXISTS (SELECT 1 FROM product_variant pv
                   JOIN inventory_lot l ON l.variant_id = pv.id
                   WHERE pv.product_id = p.id) AS "hasStock"
    FROM product p WHERE p.tenant_id = ${tenantId} ORDER BY p.name`);
}

type Attrs = {
  name: string; code: string; sku: string;
  color?: string | null; glaze?: string | null; punch?: string | null; body?: string | null;
  imageUrl?: string | null;
};

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: "duplicate_code" | "duplicate_sku" | "missing" };

/** محصولِ جدید + variant اولش. کد و sku در tenant یکتا هستند. */
export async function createProduct(tenantId: string, a: Attrs): Promise<CreateResult> {
  if (!a.name.trim() || !a.code.trim() || !a.sku.trim()) return { ok: false, reason: "missing" };
  return withTenant(tenantId, async (tx) => {
    // یکتایی صریح چک می‌شود تا پیامِ کاربرپسند بدهیم، نه خطای خامِ constraint
    const [dupCode] = await tx`SELECT 1 FROM product WHERE tenant_id = ${tenantId} AND code = ${a.code.trim()}`;
    if (dupCode) return { ok: false as const, reason: "duplicate_code" as const };
    const [dupSku] = await tx`SELECT 1 FROM product_variant WHERE tenant_id = ${tenantId} AND sku = ${a.sku.trim()}`;
    if (dupSku) return { ok: false as const, reason: "duplicate_sku" as const };

    const [p] = await tx<{ id: string }[]>`
      INSERT INTO product (tenant_id, code, name, color, glaze, punch, body, image_url)
      VALUES (${tenantId}, ${a.code.trim()}, ${a.name.trim()},
              ${a.color?.trim() || null}, ${a.glaze?.trim() || null},
              ${a.punch?.trim() || null}, ${a.body?.trim() || null}, ${a.imageUrl?.trim() || null})
      RETURNING id`;
    await tx`
      INSERT INTO product_variant (tenant_id, product_id, sku)
      VALUES (${tenantId}, ${p.id}, ${a.sku.trim()})`;
    return { ok: true as const, id: p.id };
  });
}

/**
 * ویرایشِ ویژگی‌های محصول (نه sku/code — آن‌ها کلیدِ تطبیق‌اند).
 *
 * فقط فیلدهایی که در ورودی آمده‌اند ست می‌شوند — با COALESCE روی یک sentinel.
 * الگوی شرطیِ `tx\`col\`` با undefined مشکل داشت (postgres.js undefined را رد می‌کند)،
 * پس هر فیلد را جدا و صریح آپدیت می‌کنیم؛ فیلدِ نیامده اصلاً در SET نمی‌آید.
 */
export async function updateProduct(p: {
  tenantId: string; productId: string;
  name?: string; color?: string | null; glaze?: string | null;
  punch?: string | null; body?: string | null;
}) {
  // ستونِ پویا در postgres.js دردسر دارد (identifier vs value)، پس هر ستون یک جمله‌ی
  // جدا. undefined = دست نزن؛ مقدار = ست کن (خالی → null). نام هرگز null نمی‌شود.
  const id = p.productId, t = p.tenantId;
  if (!id || !t) throw new Error("updateProduct: productId و tenantId الزامی‌اند");
  await withTenant(t, async (tx) => {
    if (p.name !== undefined && p.name.trim())
      await tx`UPDATE product SET name = ${p.name.trim()} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.color !== undefined)
      await tx`UPDATE product SET color = ${p.color?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.glaze !== undefined)
      await tx`UPDATE product SET glaze = ${p.glaze?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.punch !== undefined)
      await tx`UPDATE product SET punch = ${p.punch?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.body !== undefined)
      await tx`UPDATE product SET body = ${p.body?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
  });
}

/** عکسِ یک محصول را تنظیم/پاک می‌کند. null = حذفِ عکس. */
export async function setProductImage(p: { tenantId: string; productId: string; imageUrl: string | null }) {
  await withTenant(p.tenantId, (tx) => tx`
    UPDATE product SET image_url = ${p.imageUrl}
    WHERE id = ${p.productId} AND tenant_id = ${p.tenantId}`);
}
