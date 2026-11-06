import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { staffCtx, featureOff } from "@/auth/httpCtx";
import { writeAudit } from "@/db/audit";
import { listVolumeDiscounts, ensureDefaultPriceList } from "@/db/pricing";
import { getFeatures } from "@/db/features";
import { z } from "zod";
import { id, count, parse } from "@/lib/validate";

const SetPrice = z.object({ priceListId: id, variantId: id, price: count });


/** GET ?tenantId — لیست‌های قیمت + اقلامشان + پله‌های تخفیف (پنل قیمت‌گذاری staff). */
export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "pricing");
  if (off) return off;

  const f = await getFeatures(c.tenantId);
  const [{ lists, items }, tiers] = await Promise.all([
    withTenant(c.tenantId, async (tx) => {
      // وقتی «چند لیست قیمت» خاموش است، پنل فقط «لیست اصلی» را می‌بیند.
      const mainId = await ensureDefaultPriceList(tx, c.tenantId);
      const lists = await tx`
        SELECT pl.id, pl.name,
          (SELECT count(*) FROM agent_account aa WHERE aa.price_list_id = pl.id)::int AS "agentCount"
        FROM price_list pl
        WHERE pl.tenant_id = ${c.tenantId} AND ${f.price_lists ? tx`TRUE` : tx`pl.id = ${mainId}`}
        ORDER BY pl.is_default DESC, pl.name`;
      const visible = lists.map((l) => l.id as string);
      const items = await tx`
        SELECT pli.price_list_id AS "priceListId", pli.variant_id AS "variantId",
               pli.price, p.name, p.code, pv.sku
        FROM price_list_item pli
        JOIN product_variant pv ON pv.id = pli.variant_id
        JOIN product p ON p.id = pv.product_id
        WHERE pli.tenant_id = ${c.tenantId} AND pli.price_list_id IN ${tx(visible)} ORDER BY p.name`;
      return { lists, items };
    }),
    f.volume_discount ? listVolumeDiscounts(c.tenantId) : Promise.resolve([]),
  ]);
  const data = { lists, items, tiers };
  return NextResponse.json(data);
}

/**
 * POST {tenantId, priceListId, variantId, price} — ثبت/به‌روزرسانی قیمتِ یک کالا.
 * قیمت باید عددِ صحیحِ نامنفی باشد (کوچیک‌ترین واحد پولی، قانون #۷) — اعشار رد می‌شود.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "pricing");
  if (off) return off;

  const p = parse(SetPrice, body);
  if ("err" in p) return p.err;
  const { priceListId, variantId, price } = p.data;

  const f = await getFeatures(c.tenantId);
  const written = await withTenant(c.tenantId, async (tx) => {
    // با «چند لیست» خاموش فقط لیستِ اصلی قابلِ نوشتن است؛ لیستِ پنهان نباید مخفیانه پر شود.
    if (!f.price_lists && priceListId !== await ensureDefaultPriceList(tx, c.tenantId)) return "feature_off" as const;
    // لیست یا کالای ناموجود (یا مالِ tenantِ دیگر) قبلاً به FK می‌خورد و ۵۰۰ می‌داد
    const [found] = await tx<{ list: boolean; variant: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM price_list WHERE id = ${priceListId} AND tenant_id = ${c.tenantId}) AS list,
             EXISTS (SELECT 1 FROM product_variant WHERE id = ${variantId} AND tenant_id = ${c.tenantId}) AS variant`;
    if (!found.list || !found.variant) return "not_found" as const;

    // قیمتِ قبلی **قبل از** نوشتن خوانده می‌شود: بدون آن، ردپا فقط می‌گوید
    // «قیمت شد X» و سؤالِ اصلی («از چند آمد؟») بی‌جواب می‌ماند.
    const [prev] = await tx<{ price: string }[]>`
      SELECT price FROM price_list_item
      WHERE tenant_id = ${c.tenantId} AND price_list_id = ${priceListId} AND variant_id = ${variantId}`;

    await tx`
      INSERT INTO price_list_item (tenant_id, price_list_id, variant_id, price)
      VALUES (${c.tenantId}, ${priceListId}, ${variantId}, ${price})
      ON CONFLICT (price_list_id, variant_id) DO UPDATE SET price = EXCLUDED.price`;

    // فقط وقتی واقعاً چیزی عوض شده — ذخیره‌ی بی‌تغییر، ردپای بی‌معنی می‌سازد
    // و دفتر را پر می‌کند تا تغییرِ واقعی گم شود.
    const before = prev ? Number(prev.price) : null;
    if (before !== price)
      await writeAudit(tx, {
        tenantId: c.tenantId, actorUserId: c.userId,
        action: "price.set", entity: "price_list_item", entityId: variantId,
        oldValue: before, newValue: price,
      });
    return "ok" as const;
  });
  if (written !== "ok") return NextResponse.json({ error: written }, { status: 404 });
  return NextResponse.json({ ok: true });
}
