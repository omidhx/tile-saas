import { sql, withTenant } from "./client";

/**
 * کاتالوگ سفارشی برای مشتری (v2، spec ۱۲).
 *
 * نماینده محصول‌ها را انتخاب می‌کند و یک لینکِ عمومیِ توکن‌دار می‌گیرد؛ مشتریِ نهایی
 * بدونِ لاگین آن را می‌بیند. توابعِ نماینده همیشه به `agentAccountId` مقید می‌شوند —
 * RLS فقط tenant را جدا می‌کند، نه نماینده را از نماینده‌ی دیگرِ همان کارخانه.
 */

/** یک آیتمِ کاتالوگ در ورودی/فهرست: کدام variant + قیمتِ اختیاریِ مشتری. */
export type CatalogItemInput = { variantId: string; customerPrice: number | null };

export type CatalogRow = {
  id: string; title: string; token: string; isActive: boolean;
  items: CatalogItemInput[]; createdAt: string;
};

export type PublicItem = {
  name: string; code: string; imageUrl: string | null;
  color: string | null; glaze: string | null; punch: string | null; body: string | null;
  inStock: boolean; customerPrice: number | null;
};

/** slugِ tenant برای ساختِ لینکِ اشتراک (/c/<slug>/<token>). جدولِ tenant RLS ندارد. */
export async function getTenantSlug(tenantId: string): Promise<string | null> {
  const [t] = await sql<{ slug: string }[]>`SELECT slug FROM tenant WHERE id = ${tenantId}`;
  return t?.slug ?? null;
}

/** فهرستِ محصول‌ها برای انتخاب در سازنده‌ی کاتالوگ (نماینده). همه‌ی variantها، نه فقط موجودها. */
export function listPickableVariants(tenantId: string) {
  return withTenant(tenantId, (tx) => tx<{ id: string; name: string; code: string }[]>`
    SELECT pv.id, p.name, p.code
    FROM product_variant pv JOIN product p ON p.id = pv.product_id
    WHERE pv.tenant_id = ${tenantId} ORDER BY p.name LIMIT 500`);
}

export function listCatalogs(tenantId: string, agentAccountId: string) {
  return withTenant(tenantId, (tx) => tx<CatalogRow[]>`
    SELECT c.id, c.title, c.token, c.is_active AS "isActive", c.created_at AS "createdAt",
           COALESCE((
             SELECT json_agg(json_build_object(
                      'variantId', i.variant_id, 'customerPrice', i.customer_price) ORDER BY i.sort_order)
             FROM shared_catalog_item i WHERE i.catalog_id = c.id
           ), '[]'::json) AS items
    FROM shared_catalog c
    WHERE c.tenant_id = ${tenantId} AND c.agent_account_id = ${agentAccountId}
    ORDER BY c.created_at DESC`);
}

/** درجِ آیتم‌ها با ترتیبِ انتخاب. composite FK تضمین می‌کند variant متعلق به همین tenant است. */
async function insertItems(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string, catalogId: string, items: CatalogItemInput[],
) {
  for (let i = 0; i < items.length; i++) {
    await tx`
      INSERT INTO shared_catalog_item (tenant_id, catalog_id, variant_id, customer_price, sort_order)
      VALUES (${tenantId}, ${catalogId}, ${items[i].variantId}, ${items[i].customerPrice}, ${i})
      ON CONFLICT (catalog_id, variant_id) DO NOTHING`;
  }
}

/** کاتالوگِ جدید + آیتم‌هایش. token را لایه‌ی API می‌سازد (crypto). */
export async function createCatalog(p: {
  tenantId: string; agentAccountId: string; title: string; items: CatalogItemInput[]; token: string;
}): Promise<{ id: string }> {
  return withTenant(p.tenantId, async (tx) => {
    const [c] = await tx<{ id: string }[]>`
      INSERT INTO shared_catalog (tenant_id, agent_account_id, title, token)
      VALUES (${p.tenantId}, ${p.agentAccountId}, ${p.title.trim()}, ${p.token})
      RETURNING id`;
    await insertItems(tx, p.tenantId, c.id, p.items);
    return { id: c.id };
  });
}

/**
 * ویرایشِ کاتالوگ: عنوان + مجموعه‌ی آیتم‌ها (جای‌گزینِ کامل). مقید به نماینده —
 * اگر مالِ نماینده‌ی دیگری باشد، هیچ تغییری نمی‌کند. token دست‌نخورده می‌ماند تا
 * لینک‌های ارسال‌شده معتبر بمانند.
 */
export async function updateCatalog(p: {
  tenantId: string; agentAccountId: string; id: string; title: string; items: CatalogItemInput[];
}) {
  await withTenant(p.tenantId, async (tx) => {
    const [own] = await tx`
      SELECT 1 FROM shared_catalog
      WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND agent_account_id = ${p.agentAccountId}`;
    if (!own) return; // نماینده‌ی دیگر: بی‌اثر
    await tx`
      UPDATE shared_catalog SET title = ${p.title.trim()}
      WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND agent_account_id = ${p.agentAccountId}`;
    await tx`DELETE FROM shared_catalog_item WHERE catalog_id = ${p.id} AND tenant_id = ${p.tenantId}`;
    await insertItems(tx, p.tenantId, p.id, p.items);
  });
}

/** باطل/فعال‌کردنِ لینک — بدونِ حذفِ کاتالوگ. مقید به نماینده. */
export async function setCatalogActive(p: {
  tenantId: string; agentAccountId: string; id: string; isActive: boolean;
}) {
  await withTenant(p.tenantId, (tx) => tx`
    UPDATE shared_catalog SET is_active = ${p.isActive}
    WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND agent_account_id = ${p.agentAccountId}`);
}

export async function deleteCatalog(p: { tenantId: string; agentAccountId: string; id: string }) {
  await withTenant(p.tenantId, (tx) => tx`
    DELETE FROM shared_catalog
    WHERE id = ${p.id} AND tenant_id = ${p.tenantId} AND agent_account_id = ${p.agentAccountId}`);
}

/**
 * نمای عمومیِ کاتالوگ برای صفحه‌ی مشتری. نشستی وجود ندارد، پس:
 *   ۱. tenant را از slug (عمومی، RLS ندارد) پیدا می‌کنیم،
 *   ۲. با withTenant کاتالوگ را با token (ظرفیتِ دسترسی) و is_active می‌خوانیم.
 * اگر token و slug به یک کاتالوگ نرسند (token مالِ tenant دیگری باشد)، RLS صفر ردیف
 * می‌دهد و null برمی‌گردد. فقط قیمتِ فروشِ مشتری (اگر نماینده گذاشته) برمی‌گردد، نه
 * «قیمتِ منِ» نماینده و نه عددِ دقیقِ موجودی.
 */
export async function getPublicCatalog(p: { slug: string; token: string }) {
  const [t] = await sql<{ id: string; name: string }[]>`
    SELECT id, name FROM tenant WHERE slug = ${p.slug} AND is_active = true`;
  if (!t) return null;
  return withTenant(t.id, async (tx) => {
    const [cat] = await tx<{ id: string; title: string }[]>`
      SELECT id, title FROM shared_catalog
      WHERE token = ${p.token} AND is_active = true AND tenant_id = ${t.id}`;
    if (!cat) return null;
    const rows = await tx<(Omit<PublicItem, "customerPrice"> & { customerPrice: string | null })[]>`
      SELECT p.name, p.code, p.image_url AS "imageUrl", p.color, p.glaze, p.punch, p.body,
             ci.customer_price AS "customerPrice",
             EXISTS (
               SELECT 1 FROM v_lot_availability a
               JOIN inventory_lot l ON l.id = a.lot_id
               WHERE l.variant_id = ci.variant_id AND a.available_qty_boxes > 0
             ) AS "inStock"
      FROM shared_catalog_item ci
      JOIN product_variant pv ON pv.id = ci.variant_id
      JOIN product p          ON p.id = pv.product_id
      WHERE ci.catalog_id = ${cat.id}
      ORDER BY ci.sort_order, p.name`;
    // customer_price بیگ‌اینت است و رشته برمی‌گردد → عدد. NULL = قیمت نشان نده.
    const items = rows.map((r) => ({ ...r, customerPrice: r.customerPrice == null ? null : Number(r.customerPrice) }));
    return { tenantName: t.name, title: cat.title, items };
  });
}
