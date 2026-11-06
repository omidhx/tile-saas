import { NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/validate";
import { staffCtx, featureOff } from "@/auth/httpCtx";
import { createPriceList } from "@/db/pricing";

const Create = z.object({ name: z.string().refine((v) => v.trim() !== "") });

/** POST {tenantId, name} — ساختِ سبدِ قیمت‌گذاریِ تازه (staff). تا حالا فقط SQL. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "price_lists");
  if (off) return off;

  const p = parse(Create, body);
  if ("err" in p) return p.err;

  const list = await createPriceList(c.tenantId, p.data.name);
  return NextResponse.json({ list }, { status: 201 });
}
