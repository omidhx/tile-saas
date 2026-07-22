import { withTenant } from "./client";

/**
 * محصولات — فعلاً فقط برای کاتالوگ تصویری (v2): فهرست با عکس، و تنظیمِ عکس.
 * محصول از طریق import ساخته می‌شود؛ اینجا فقط عکسش مدیریت می‌شود.
 */

export type ProductRow = {
  id: string; name: string; code: string;
  imageUrl: string | null; color: string | null; glaze: string | null; punch: string | null;
};

export function listProducts(tenantId: string) {
  return withTenant(tenantId, (tx) => tx<ProductRow[]>`
    SELECT id, name, code, image_url AS "imageUrl", color, glaze, punch
    FROM product WHERE tenant_id = ${tenantId} ORDER BY name`);
}

/** عکسِ یک محصول را تنظیم/پاک می‌کند. null = حذفِ عکس. */
export async function setProductImage(p: { tenantId: string; productId: string; imageUrl: string | null }) {
  await withTenant(p.tenantId, (tx) => tx`
    UPDATE product SET image_url = ${p.imageUrl}
    WHERE id = ${p.productId} AND tenant_id = ${p.tenantId}`);
}
