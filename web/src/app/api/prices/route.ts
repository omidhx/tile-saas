import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";

/** context مشترک: staff-only — قیمت‌گذاری کارِ پشتیبان است، نه نماینده. */
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

/** GET ?tenantId — لیست‌های قیمت + اقلامشان + پله‌های تخفیف (پنل قیمت‌گذاری staff). */
export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;

  const data = await withTenant(c.tenantId, async (tx) => {
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
    const tiers = await tx`
      SELECT vd.id, vd.price_list_id AS "priceListId", vd.variant_id AS "variantId",
             vd.min_qty_boxes AS "minQty", vd.percent_off AS "percentOff", p.name
      FROM volume_discount vd
      LEFT JOIN product_variant pv ON pv.id = vd.variant_id
      LEFT JOIN product p ON p.id = pv.product_id
      WHERE vd.tenant_id = ${c.tenantId} ORDER BY vd.min_qty_boxes`;
    return { lists, items, tiers };
  });
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

  await withTenant(c.tenantId, (tx) => tx`
    INSERT INTO price_list_item (tenant_id, price_list_id, variant_id, price)
    VALUES (${c.tenantId}, ${priceListId}, ${variantId}, ${price})
    ON CONFLICT (price_list_id, variant_id) DO UPDATE SET price = EXCLUDED.price`);
  return NextResponse.json({ ok: true });
}
