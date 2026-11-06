import { NextResponse } from "next/server";
import { z } from "zod";
import { id, parse } from "@/lib/validate";
import { agentCtx } from "@/auth/httpCtx";
import { suggestSubstitutes } from "@/db/substitutes";
import { expectedArrivals } from "@/db/incoming";
import { getFeatures } from "@/db/features";
import { subscribeAlert, unsubscribeAlert, listAlertsAndOutOfStock } from "@/db/alerts";

const Body = z.object({ variantId: id });

/** GET ?tenantId&agentAccountId — اشتراک‌های من + کالاهای ناموجود (برای دکمه‌ی «خبرم کن»). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await agentCtx(u.searchParams.get("tenantId"), u.searchParams.get("agentAccountId"));
  if ("err" in c) return c.err;

  const data = await listAlertsAndOutOfStock(c);
  // جایگزین‌ها همراهِ همین پاسخ می‌آیند، نه در یک درخواستِ جدا: دقیقاً برای همین
  // کالاهای ناموجود لازم‌اند و رفت‌وبرگشتِ دومی فقط صفحه را کندتر می‌کرد.
  const variantIds = data.outOfStock.map((v) => v.variantId);
  const [substitutes, arrivals] = await Promise.all([
    (await getFeatures(c.tenantId)).substitutes ? suggestSubstitutes({ ...c, variantIds }) : Promise.resolve({}),
    // «کِی می‌رسد» کنارِ «چه چیزی به‌جایش هست»: نماینده باید بتواند بین صبر کردن
    // و گرفتنِ جایگزین انتخاب کند، و برای این انتخاب هر دو را لازم دارد.
    expectedArrivals({ tenantId: c.tenantId, variantIds }),
  ]);
  return NextResponse.json({ ...data, substitutes, arrivals });
}

/** POST {tenantId, agentAccountId, variantId} — اشتراک. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await agentCtx(body?.tenantId, body?.agentAccountId);
  if ("err" in c) return c.err;
  const p = parse(Body, body);
  if ("err" in p) return p.err;
  await subscribeAlert({ ...c, variantId: p.data.variantId });
  return NextResponse.json({ ok: true }, { status: 201 });
}

/** DELETE {tenantId, agentAccountId, variantId} — لغو اشتراک. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await agentCtx(body?.tenantId, body?.agentAccountId);
  if ("err" in c) return c.err;
  const p = parse(Body, body);
  if ("err" in p) return p.err;
  await unsubscribeAlert({ ...c, variantId: p.data.variantId });
  return NextResponse.json({ ok: true });
}
