import { withTenant } from "./client";
import { resolvePricesIn } from "./pricing";

/**
 * پیشنهاد کالای جایگزین (v2، spec ۹).
 *
 * دو منبع، به همین ترتیب:
 *   ۱. **تعریفِ صریحِ کارخانه** (`product_substitute`) — قابل اعتماد، چون آدم گفته.
 *   ۲. **همان محصول با درجه‌ی دیگر** — خودکار و بدونِ تنظیم، چون از نظر ساختاری
 *      تضمین‌شده همان کاشی است (`product_id` یکی، `grade` فرق دارد). این تنها
 *      تطبیقِ خودکاری است که حدس نمی‌زند.
 *
 * صفت‌های دیگر (رنگ/لعاب/اندازه) عمداً استفاده نمی‌شوند: ابعاد فیلدِ ساختاریافته
 * ندارد و بقیه nullable و پرنشده‌اند، پس تطبیق روی‌شان یعنی پیشنهادِ اشتباه.
 *
 * **فقط جایگزینِ موجود برگردانده می‌شود.** پیشنهادِ کالایی که آن هم ناموجود است،
 * از پیشنهاد ندادن بدتر است — نماینده را دو بار ناامید می‌کند.
 */

export type Substitute = {
  variantId: string;
  name: string;
  code: string;
  grade: string | null;
  available: number;
  unitPrice: number | null;
  /** توضیحِ کارخانه، یا null برای پیشنهادِ خودکارِ هم‌محصول. */
  note: string | null;
  /** از کجا آمد — تا UI بتواند «پیشنهاد کارخانه» را از «درجه‌ی دیگر» جدا نشان دهد. */
  source: "explicit" | "same_product";
};

export async function suggestSubstitutes(p: {
  tenantId: string;
  agentAccountId: string;
  /** کالاهایی که نماینده می‌خواست و نبودند. */
  variantIds: string[];
}): Promise<Record<string, Substitute[]>> {
  if (p.variantIds.length === 0) return {};

  return withTenant(p.tenantId, async (tx) => {
    const rows = await tx<{
      forVariant: string; variantId: string; name: string; code: string;
      grade: string | null; available: number; note: string | null; source: "explicit" | "same_product";
    }[]>`
      WITH avail AS (
        -- موجودیِ قابل‌سفارش به‌ازای هر variant (جمعِ همه‌ی lotها و انبارها)
        SELECT l.variant_id, SUM(a.available_qty_boxes)::int AS available
        FROM v_lot_availability a
        JOIN inventory_lot l ON l.id = a.lot_id
        WHERE l.tenant_id = ${p.tenantId} AND a.available_qty_boxes > 0
        GROUP BY l.variant_id
      ),
      explicit AS (
        SELECT ps.variant_id AS "forVariant", ps.substitute_variant_id AS "variantId",
               ps.note, ps.sort_order, 'explicit'::text AS source
        FROM product_substitute ps
        WHERE ps.tenant_id = ${p.tenantId} AND ps.variant_id IN ${tx(p.variantIds)}
      ),
      same_product AS (
        -- همان محصول، درجه‌ی دیگر. اگر کارخانه صریحاً همین را تعریف کرده باشد،
        -- نسخه‌ی صریح برنده است (NOT EXISTS پایین‌تر).
        SELECT want.id AS "forVariant", other.id AS "variantId",
               NULL::text AS note, 1000 AS sort_order, 'same_product'::text AS source
        FROM product_variant want
        JOIN product_variant other
          ON other.product_id = want.product_id AND other.id <> want.id
         AND other.tenant_id = want.tenant_id
        WHERE want.tenant_id = ${p.tenantId} AND want.id IN ${tx(p.variantIds)}
      ),
      merged AS (
        SELECT * FROM explicit
        UNION ALL
        SELECT sp.* FROM same_product sp
        WHERE NOT EXISTS (
          SELECT 1 FROM explicit e
          WHERE e."forVariant" = sp."forVariant" AND e."variantId" = sp."variantId"
        )
      )
      SELECT m."forVariant", m."variantId", p.name, p.code, pv.grade,
             av.available, m.note, m.source
      FROM merged m
      JOIN product_variant pv ON pv.id = m."variantId"
      JOIN product p          ON p.id = pv.product_id
      -- JOIN (نه LEFT JOIN): جایگزینِ ناموجود اصلاً برنمی‌گردد
      JOIN avail av           ON av.variant_id = m."variantId"
      ORDER BY m."forVariant", m.sort_order, p.name`;

    if (rows.length === 0) return {};

    // «قیمت من» — همان قاعده‌ی بقیه‌ی جاها: نماینده قیمتِ خودش را می‌بیند.
    const prices = await resolvePricesIn(tx, {
      tenantId: p.tenantId, agentAccountId: p.agentAccountId,
      variantIds: [...new Set(rows.map((r) => r.variantId))],
    });

    const out: Record<string, Substitute[]> = {};
    for (const r of rows) {
      (out[r.forVariant] ??= []).push({
        variantId: r.variantId, name: r.name, code: r.code, grade: r.grade,
        available: r.available, note: r.note, source: r.source,
        unitPrice: prices.get(r.variantId)?.unitPrice ?? null,
      });
    }
    return out;
  });
}

/** فهرستِ جایگزین‌های تعریف‌شده (پنل staff). */
export async function listSubstitutes(tenantId: string) {
  return withTenant(tenantId, (tx) => tx<{
    id: string; variantId: string; variantName: string; variantCode: string;
    substituteVariantId: string; substituteName: string; substituteCode: string; note: string | null;
  }[]>`
    SELECT ps.id,
           ps.variant_id AS "variantId", p1.name AS "variantName", p1.code AS "variantCode",
           ps.substitute_variant_id AS "substituteVariantId",
           p2.name AS "substituteName", p2.code AS "substituteCode", ps.note
    FROM product_substitute ps
    JOIN product_variant v1 ON v1.id = ps.variant_id
    JOIN product p1         ON p1.id = v1.product_id
    JOIN product_variant v2 ON v2.id = ps.substitute_variant_id
    JOIN product p2         ON p2.id = v2.product_id
    WHERE ps.tenant_id = ${tenantId}
    ORDER BY p1.name, ps.sort_order`);
}

export async function addSubstitute(p: {
  tenantId: string; variantId: string; substituteVariantId: string; note?: string | null;
}) {
  if (p.variantId === p.substituteVariantId) throw new Error("کالا نمی‌تواند جایگزینِ خودش باشد");
  await withTenant(p.tenantId, (tx) => tx`
    INSERT INTO product_substitute (tenant_id, variant_id, substitute_variant_id, note)
    VALUES (${p.tenantId}, ${p.variantId}, ${p.substituteVariantId}, ${p.note ?? null})
    ON CONFLICT (tenant_id, variant_id, substitute_variant_id)
    DO UPDATE SET note = EXCLUDED.note`);
}

export async function removeSubstitute(p: { tenantId: string; id: string }) {
  await withTenant(p.tenantId, (tx) => tx`
    DELETE FROM product_substitute WHERE tenant_id = ${p.tenantId} AND id = ${p.id}`);
}
