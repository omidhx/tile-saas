import { withTenant } from "./client";
import type { TransactionSql } from "postgres";

/**
 * مدیریتِ محصول (v2). محصول اینجا **ساخته** می‌شود — قبلاً فقط seed/SQL دستی بود.
 *
 * نکته‌ی ساختاری: محصول برای **قابلِ سفارش شدن** به یک `product_variant` (با `sku`)
 * نیاز دارد. پس ساختِ محصول هم‌زمان یک variant می‌سازد.
 *
 * گالریِ تصاویر: `product_image` منبعِ حقیقت است (چند عکس، مرتب با sort_order).
 * `product.image_url` کَشِ عکسِ اصلی (کمترین sort_order) است تا تامنیل همه‌جا بدونِ
 * join خوانده شود. هر تغییرِ گالری، `syncPrimary` را صدا می‌زند تا کَش تازه بماند.
 */

export type ProductImage = { id: string; url: string };

export type ProductRow = {
  id: string; name: string; code: string;
  imageUrl: string | null; color: string | null; glaze: string | null;
  punch: string | null; body: string | null;
  size: string | null; thickness: string | null; usageArea: string | null; description: string | null;
  /** گالریِ کامل، مرتب؛ اولی = عکسِ اصلی. */
  images: ProductImage[];
  /** sku اولین variant — برای ورودِ موجودیِ اکسل لازم است (تطبیق با همین). */
  sku: string | null;
  /** variantِ اول — برای مدیریتِ جایگزینِ همین محصول لازم است. */
  variantId: string | null;
  /** بسته‌بندیِ فیزیکی — برای تبدیلِ کارتن⇄پالت⇄مترمربع در صفحه‌ی سفارشِ نماینده.
   *  مشخصه‌ی ثابتِ کارخانه است، پس یک‌بار اینجا تنظیم می‌شود نه هر بار توسطِ نماینده. */
  boxesPerPallet: number | null;
  sqcmPerBox: number | null;
  hasStock: boolean;
  /** قیمت در لیستِ پایه — فقط نمایشی؛ ویرایش در صفحه‌ی قیمت‌گذاری. */
  basePrice: number | null;
};

export function listProducts(tenantId: string) {
  return withTenant(tenantId, async (tx) => {
    const rows = await tx<(Omit<ProductRow, "basePrice"> & { basePrice: string | null })[]>`
      SELECT p.id, p.name, p.code, p.image_url AS "imageUrl",
             p.color, p.glaze, p.punch, p.body,
             p.size, p.thickness, p.usage_area AS "usageArea", p.description,
             v.id AS "variantId", v.sku, v.boxes_per_pallet AS "boxesPerPallet", v.sqcm_per_box AS "sqcmPerBox",
             EXISTS (SELECT 1 FROM inventory_lot l WHERE l.variant_id = v.id) AS "hasStock",
             COALESCE((
               SELECT json_agg(json_build_object('id', i.id, 'url', i.url) ORDER BY i.sort_order, i.id)
               FROM product_image i WHERE i.product_id = p.id
             ), '[]'::json) AS images,
             (SELECT pli.price FROM price_list_item pli
              JOIN price_list pl ON pl.id = pli.price_list_id
              WHERE pli.variant_id = v.id AND pl.tenant_id = ${tenantId}
              ORDER BY pl.name LIMIT 1) AS "basePrice"
      FROM product p
      LEFT JOIN LATERAL (
        SELECT pv.id, pv.sku, pv.boxes_per_pallet, pv.sqcm_per_box FROM product_variant pv
        WHERE pv.product_id = p.id ORDER BY pv.sku LIMIT 1
      ) v ON TRUE
      WHERE p.tenant_id = ${tenantId} ORDER BY p.name`;
    return rows.map((r) => ({ ...r, basePrice: r.basePrice == null ? null : Number(r.basePrice) }));
  });
}

type Attrs = {
  name: string; code: string; sku: string;
  color?: string | null; glaze?: string | null; punch?: string | null; body?: string | null;
  size?: string | null; thickness?: string | null; usageArea?: string | null; description?: string | null;
  imageUrl?: string | null;
  /** بسته‌بندیِ variantِ اول؛ روی خودِ product_variant ذخیره می‌شود نه product. */
  boxesPerPallet?: number | null; sqcmPerBox?: number | null;
  /** موجودیِ اولیه (اختیاری) — برای وقتی که کارخانه از همین‌جا موجودی هم ثبت می‌کند،
   *  نه فقط از ورودِ اکسل/کالای در راه. یک lot تازه در انبارِ انتخابی می‌سازد. */
  initialStock?: { warehouseId: string; quantityBoxes: number };
};

export type CreateResult =
  | { ok: true; id: string }
  | { ok: false; reason: "duplicate_code" | "duplicate_sku" | "missing" };

/** image_url را برابرِ عکسِ اصلی (کمترین sort_order) می‌کند — کَش را تازه نگه می‌دارد. */
function syncPrimary(tx: TransactionSql, tenantId: string, productId: string) {
  return tx`
    UPDATE product SET image_url = (
      SELECT url FROM product_image
      WHERE product_id = ${productId} AND tenant_id = ${tenantId}
      ORDER BY sort_order, id LIMIT 1
    ) WHERE id = ${productId} AND tenant_id = ${tenantId}`;
}

/** عکس را به گالری اضافه می‌کند (idempotent روی url) و کَشِ اصلی را همگام می‌کند.
 *  نسخه‌ی tx-محور تا در تراکنشِ import هم بشود استفاده کرد. */
export async function addProductImageTx(tx: TransactionSql, tenantId: string, productId: string, url: string) {
  await tx`
    INSERT INTO product_image (tenant_id, product_id, url, sort_order)
    SELECT ${tenantId}, ${productId}, ${url},
           COALESCE((SELECT MAX(sort_order) + 1 FROM product_image
                     WHERE product_id = ${productId} AND tenant_id = ${tenantId}), 0)
    WHERE NOT EXISTS (
      SELECT 1 FROM product_image
      WHERE product_id = ${productId} AND tenant_id = ${tenantId} AND url = ${url})`;
  await syncPrimary(tx, tenantId, productId);
}

/** محصولِ جدید + variant اولش. کد و sku در tenant یکتا هستند.
 *  actorUserId فقط برای لجرِ موجودیِ اولیه لازم است (رفِ audit). */
export async function createProduct(tenantId: string, a: Attrs, actorUserId?: string): Promise<CreateResult> {
  if (!a.name.trim() || !a.code.trim() || !a.sku.trim()) return { ok: false, reason: "missing" };
  return withTenant(tenantId, async (tx) => {
    const [dupCode] = await tx`SELECT 1 FROM product WHERE tenant_id = ${tenantId} AND code = ${a.code.trim()}`;
    if (dupCode) return { ok: false as const, reason: "duplicate_code" as const };
    const [dupSku] = await tx`SELECT 1 FROM product_variant WHERE tenant_id = ${tenantId} AND sku = ${a.sku.trim()}`;
    if (dupSku) return { ok: false as const, reason: "duplicate_sku" as const };

    const [p] = await tx<{ id: string }[]>`
      INSERT INTO product (tenant_id, code, name, color, glaze, punch, body, size, thickness, usage_area, description)
      VALUES (${tenantId}, ${a.code.trim()}, ${a.name.trim()},
              ${a.color?.trim() || null}, ${a.glaze?.trim() || null},
              ${a.punch?.trim() || null}, ${a.body?.trim() || null},
              ${a.size?.trim() || null}, ${a.thickness?.trim() || null},
              ${a.usageArea?.trim() || null}, ${a.description?.trim() || null})
      RETURNING id`;
    const [v] = await tx<{ id: string }[]>`
      INSERT INTO product_variant (tenant_id, product_id, sku, boxes_per_pallet, sqcm_per_box)
      VALUES (${tenantId}, ${p.id}, ${a.sku.trim()}, ${a.boxesPerPallet ?? null}, ${a.sqcmPerBox ?? null})
      RETURNING id`;
    if (a.imageUrl?.trim()) await addProductImageTx(tx, tenantId, p.id, a.imageUrl.trim());

    // موجودیِ اولیه: همان مسیرِ لجرِ import/incoming (lot + balance + transaction)
    // تا گزارشِ تطبیق از همان اول درست بماند، نه یک UPDATE مستقیمِ بدونِ ردِ حسابرسی.
    if (a.initialStock && a.initialStock.quantityBoxes > 0) {
      const [lot] = await tx<{ id: string }[]>`
        INSERT INTO inventory_lot (tenant_id, variant_id, warehouse_id)
        VALUES (${tenantId}, ${v.id}, ${a.initialStock.warehouseId})
        RETURNING id`;
      await tx`
        INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes)
        VALUES (${tenantId}, ${lot.id}, ${a.initialStock.quantityBoxes})`;
      await tx`
        INSERT INTO inventory_transaction
          (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, reference_type, reference_id, actor_user_id)
        VALUES (${tenantId}, ${lot.id}, 'initial_stock', ${a.initialStock.quantityBoxes}, 'product', ${p.id}, ${actorUserId ?? null})`;
    }
    return { ok: true as const, id: p.id };
  });
}

/**
 * ویرایشِ ویژگی‌های محصول (نه sku/code — کلیدِ تطبیق‌اند). فقط فیلدهای آمده ست می‌شوند.
 */
export async function updateProduct(p: {
  tenantId: string; productId: string;
  name?: string; color?: string | null; glaze?: string | null; punch?: string | null; body?: string | null;
  size?: string | null; thickness?: string | null; usageArea?: string | null; description?: string | null;
  /** بسته‌بندی روی خودِ variant ذخیره می‌شود؛ بدونِ variantId نادیده گرفته می‌شود. */
  variantId?: string; boxesPerPallet?: number | null; sqcmPerBox?: number | null;
}) {
  const id = p.productId, t = p.tenantId;
  if (!id || !t) throw new Error("updateProduct: productId و tenantId الزامی‌اند");
  await withTenant(t, async (tx) => {
    if (p.name !== undefined && p.name.trim())
      await tx`UPDATE product SET name = ${p.name.trim()} WHERE id = ${id} AND tenant_id = ${t}`;
    // بقیه‌ی فیلدها: undefined = دست نزن، مقدار = ست (خالی → null). هر ستون یک جمله.
    if (p.color !== undefined) await tx`UPDATE product SET color = ${p.color?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.glaze !== undefined) await tx`UPDATE product SET glaze = ${p.glaze?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.punch !== undefined) await tx`UPDATE product SET punch = ${p.punch?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.body !== undefined) await tx`UPDATE product SET body = ${p.body?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.size !== undefined) await tx`UPDATE product SET size = ${p.size?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.thickness !== undefined) await tx`UPDATE product SET thickness = ${p.thickness?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.usageArea !== undefined) await tx`UPDATE product SET usage_area = ${p.usageArea?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.description !== undefined) await tx`UPDATE product SET description = ${p.description?.trim() || null} WHERE id = ${id} AND tenant_id = ${t}`;
    if (p.variantId) {
      if (p.boxesPerPallet !== undefined)
        await tx`UPDATE product_variant SET boxes_per_pallet = ${p.boxesPerPallet} WHERE id = ${p.variantId} AND tenant_id = ${t}`;
      if (p.sqcmPerBox !== undefined)
        await tx`UPDATE product_variant SET sqcm_per_box = ${p.sqcmPerBox} WHERE id = ${p.variantId} AND tenant_id = ${t}`;
    }
  });
}

/** عکسِ جدید به گالری. */
export async function addProductImage(p: { tenantId: string; productId: string; url: string }) {
  if (!p.url.trim()) return;
  await withTenant(p.tenantId, (tx) => addProductImageTx(tx, p.tenantId, p.productId, p.url.trim()));
}

/** حذفِ یک عکس از گالری؛ اگر اصلی بود، عکسِ بعدی خودکار اصلی می‌شود. */
export async function removeProductImage(p: { tenantId: string; imageId: string }) {
  await withTenant(p.tenantId, async (tx) => {
    const [row] = await tx<{ product_id: string }[]>`
      DELETE FROM product_image WHERE id = ${p.imageId} AND tenant_id = ${p.tenantId}
      RETURNING product_id`;
    if (row) await syncPrimary(tx, p.tenantId, row.product_id);
  });
}

/** یک عکسِ گالری را «اصلی» می‌کند: کمترین sort_order را می‌گیرد و کَش را همگام می‌کند. */
export async function setPrimaryImage(p: { tenantId: string; imageId: string }) {
  await withTenant(p.tenantId, async (tx) => {
    const [row] = await tx<{ product_id: string }[]>`
      SELECT product_id FROM product_image WHERE id = ${p.imageId} AND tenant_id = ${p.tenantId}`;
    if (!row) return;
    await tx`
      UPDATE product_image SET sort_order = (
        SELECT COALESCE(MIN(sort_order), 0) - 1 FROM product_image
        WHERE product_id = ${row.product_id} AND tenant_id = ${p.tenantId}
      ) WHERE id = ${p.imageId} AND tenant_id = ${p.tenantId}`;
    await syncPrimary(tx, p.tenantId, row.product_id);
  });
}
