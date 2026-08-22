import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { staffPageCtx } from "@/auth/httpCtx";
import { writeAudit } from "@/db/audit";
import { listVolumeDiscounts } from "@/db/pricing";

/** قیمت‌گذاری کارِ پشتیبان است، نه نماینده. */
const staffCtx = (tenantId: unknown) => staffPageCtx(tenantId, "prices");

/** GET ?tenantId — لیست‌های قیمت + اقلامشان + پله‌های تخفیف (پنل قیمت‌گذاری staff). */
export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;

  const [{ lists, items }, tiers] = await Promise.all([
    withTenant(c.tenantId, async (tx) => {
      const lists = await tx`
        SELECT pl.id, pl.name,
          (SELECT count(*) FROM agent_account aa WHERE aa.price_list_id = pl.id)::int AS "agentCount"
        FROM price_list pl WHERE pl.tenant_id = ${c.tenantId} ORDER BY pl.name`;
      const items = await tx`
        SELECT pli.price_list_id AS "priceListId", pli.variant_id AS "variantId",
               pli.price, p.name, p.code, pv.sku
        FROM price_list_item pli
        JOIN product_variant pv ON pv.id = pli.variant_id
        JOIN product p ON p.id = pv.product_id
        WHERE pli.tenant_id = ${c.tenantId} ORDER BY p.name`;
      return { lists, items };
    }),
    listVolumeDiscounts(c.tenantId),
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

  const { priceListId, variantId, price } = body ?? {};
  if (typeof priceListId !== "string" || typeof variantId !== "string"
      || !Number.isInteger(price) || price < 0)
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  await withTenant(c.tenantId, async (tx) => {
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
  });
  return NextResponse.json({ ok: true });
}
