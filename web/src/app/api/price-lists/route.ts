import { NextResponse } from "next/server";
import { staffCtx, featureOff } from "@/auth/httpCtx";
import { createPriceList } from "@/db/pricing";

/** POST {tenantId, name} — ساختِ سبدِ قیمت‌گذاریِ تازه (staff). تا حالا فقط SQL. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "price_lists");
  if (off) return off;

  const { name } = body ?? {};
  if (typeof name !== "string" || !name.trim())
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const list = await createPriceList(c.tenantId, name);
  return NextResponse.json({ list }, { status: 201 });
}
