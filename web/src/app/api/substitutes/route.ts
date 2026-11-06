import { NextResponse } from "next/server";
import { z } from "zod";
import { id, parse } from "@/lib/validate";
import { staffCtx, featureOff } from "@/auth/httpCtx";
import { listSubstitutes, addSubstitute, removeSubstitute } from "@/db/substitutes";

const Add = z.object({ variantId: id, substituteVariantId: id, note: z.string().nullish() });
const Remove = z.object({ id });

export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "substitutes");
  if (off) return off;
  return NextResponse.json({ items: await listSubstitutes(c.tenantId) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "substitutes");
  if (off) return off;

  const p = parse(Add, body);
  if ("err" in p) return p.err;
  const { variantId, substituteVariantId, note } = p.data;
  if (variantId === substituteVariantId)
    return NextResponse.json({ error: "same_variant" }, { status: 400 });

  await addSubstitute({
    tenantId: c.tenantId, variantId, substituteVariantId,
    note: note?.trim() || null,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const off = await featureOff(c.tenantId, "substitutes");
  if (off) return off;
  const p = parse(Remove, body);
  if ("err" in p) return p.err;

  await removeSubstitute({ tenantId: c.tenantId, id: p.data.id });
  return NextResponse.json({ ok: true });
}
