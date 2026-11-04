import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaffPage, AuthzError } from "@/auth/authz";
import { applyPriceImport } from "@/db/pricing";

/**
 * POST {tenantId, priceListId, rows: [{sku, price}]} — ورودِ اکسلِ قیمت برای یک سبد.
 * فایل خودِ مرورگر پارس می‌کند (SheetJS، مثلِ /staff/import)؛ اینجا فقط ردیف‌های
 * پارس‌شده را می‌گیرد.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { tenantId, priceListId, rows } = body ?? {};
  if (typeof tenantId !== "string" || typeof priceListId !== "string" || !Array.isArray(rows))
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  const cleanRows = rows
    .filter((r): r is { sku: unknown; price: unknown } => r && typeof r === "object")
    .map((r) => ({ sku: typeof r.sku === "string" ? r.sku.trim() : "", price: Number(r.price) }));

  try {
    await authorizeStaffPage(userId, tenantId, "prices");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const result = await applyPriceImport({ tenantId, priceListId, actorUserId: userId, rows: cleanRows });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 404 });
  return NextResponse.json({ applied: result.applied, errors: result.errors });
}
