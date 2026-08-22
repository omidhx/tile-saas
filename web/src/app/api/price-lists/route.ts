import { NextResponse } from "next/server";
import { staffPageCtx } from "@/auth/httpCtx";
import { createPriceList } from "@/db/pricing";

/** POST {tenantId, name} — ساختِ سبدِ قیمت‌گذاریِ تازه (staff، pageKey=prices). تا حالا فقط SQL. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffPageCtx(body?.tenantId, "prices");
  if ("err" in c) return c.err;

  const { name } = body ?? {};
  if (typeof name !== "string" || !name.trim())
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const list = await createPriceList(c.tenantId, name);
  return NextResponse.json({ list }, { status: 201 });
}
