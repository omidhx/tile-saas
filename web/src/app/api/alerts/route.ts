import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeAgent, AuthzError } from "@/auth/authz";
import { suggestSubstitutes } from "@/db/substitutes";
import { expectedArrivals } from "@/db/incoming";
import { subscribeAlert, unsubscribeAlert, listAlertsAndOutOfStock } from "@/db/alerts";

/** context مشترک: احراز هویت + مجوزِ همین نمایندگی (chokepoint IDOR). */
async function ctx(tenantId: unknown, agentAccountId: unknown) {
  const userId = await currentUserId();
  if (!userId) return { err: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  if (typeof tenantId !== "string" || typeof agentAccountId !== "string")
    return { err: NextResponse.json({ error: "invalid" }, { status: 400 }) };
  try {
    await authorizeAgent(userId, tenantId, agentAccountId);
  } catch (e) {
    if (e instanceof AuthzError) return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    throw e;
  }
  return { tenantId, agentAccountId };
}

/** GET ?tenantId&agentAccountId — اشتراک‌های من + کالاهای ناموجود (برای دکمه‌ی «خبرم کن»). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await ctx(u.searchParams.get("tenantId"), u.searchParams.get("agentAccountId"));
  if ("err" in c) return c.err;

  const data = await listAlertsAndOutOfStock(c);
  // جایگزین‌ها همراهِ همین پاسخ می‌آیند، نه در یک درخواستِ جدا: دقیقاً برای همین
  // کالاهای ناموجود لازم‌اند و رفت‌وبرگشتِ دومی فقط صفحه را کندتر می‌کرد.
  const variantIds = data.outOfStock.map((v) => v.variantId);
  const [substitutes, arrivals] = await Promise.all([
    suggestSubstitutes({ ...c, variantIds }),
    // «کِی می‌رسد» کنارِ «چه چیزی به‌جایش هست»: نماینده باید بتواند بین صبر کردن
    // و گرفتنِ جایگزین انتخاب کند، و برای این انتخاب هر دو را لازم دارد.
    expectedArrivals({ tenantId: c.tenantId, variantIds }),
  ]);
  return NextResponse.json({ ...data, substitutes, arrivals });
}

/** POST {tenantId, agentAccountId, variantId} — اشتراک. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await ctx(body?.tenantId, body?.agentAccountId);
  if ("err" in c) return c.err;
  if (typeof body.variantId !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });
  await subscribeAlert({ ...c, variantId: body.variantId });
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** DELETE {tenantId, agentAccountId, variantId} — لغو اشتراک. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await ctx(body?.tenantId, body?.agentAccountId);
  if ("err" in c) return c.err;
  if (typeof body.variantId !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });
  await unsubscribeAlert({ ...c, variantId: body.variantId });
  return NextResponse.json({ ok: true });
}
