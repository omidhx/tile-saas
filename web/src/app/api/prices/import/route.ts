import { NextResponse } from "next/server";
import { z } from "zod";
import { id, isId, parse } from "@/lib/validate";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { featureOff } from "@/auth/httpCtx";
import { applyPriceImport } from "@/db/pricing";

// سطرِ خراب (بدونِ sku / قیمتِ غیرعددی) را applyPriceImport در errors گزارش می‌دهد، نه ۴۰۰ کلِ فایل.
const Import = z.object({ priceListId: id, rows: z.array(z.unknown()) });

/**
 * POST {tenantId, priceListId, rows: [{sku, price}]} — ورودِ اکسلِ قیمت برای یک سبد.
 * فایل خودِ مرورگر پارس می‌کند (SheetJS، مثلِ /staff/import)؛ اینجا فقط ردیف‌های
 * پارس‌شده را می‌گیرد.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const tenantId = body?.tenantId;
  if (!isId(tenantId)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const off = await featureOff(tenantId, "price_import");
  if (off) return off;

  const p = parse(Import, body);
  if ("err" in p) return p.err;
  const { priceListId, rows } = p.data;
  const cleanRows = rows
    .filter((r): r is { sku: unknown; price: unknown } => !!r && typeof r === "object")
    .map((r) => ({ sku: typeof r.sku === "string" ? r.sku.trim() : "", price: Number(r.price) }));

  const result = await applyPriceImport({ tenantId, priceListId, actorUserId: userId, rows: cleanRows });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
  return NextResponse.json({ applied: result.applied, errors: result.errors });
}
