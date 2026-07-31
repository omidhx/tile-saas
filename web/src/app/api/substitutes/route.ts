import { NextResponse } from "next/server";
import { staffCtx, staffPageCtx as staffPageCtxOf } from "@/auth/httpCtx";
import { listSubstitutes, addSubstitute, removeSubstitute } from "@/db/substitutes";

/**
 * GETِ این فهرست را /staff/catalog هم برای شمارشِ «جایگزین‌ها (N)» صدا می‌زند،
 * پس pageKey رویش نمی‌گذاریم (وگرنه staffِ محدود به فقط catalog اینجا هم گیر
 * می‌کرد). ویرایشِ واقعی (POST/DELETE) فقط از /staff/substitutes ممکن است،
 * پس همان‌جا pageKey='substitutes' اعمال می‌شود.
 */
const staffPageCtx = (tenantId: unknown) => staffPageCtxOf(tenantId, "substitutes");

export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  return NextResponse.json({ items: await listSubstitutes(c.tenantId) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffPageCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { variantId, substituteVariantId, note } = body ?? {};
  if (typeof variantId !== "string" || typeof substituteVariantId !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (variantId === substituteVariantId)
    return NextResponse.json({ error: "same_variant" }, { status: 400 });

  await addSubstitute({
    tenantId: c.tenantId, variantId, substituteVariantId,
    note: typeof note === "string" && note.trim() ? note.trim() : null,
  });
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffPageCtx(body?.tenantId);
  if ("err" in c) return c.err;
  if (typeof body?.id !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });

  await removeSubstitute({ tenantId: c.tenantId, id: body.id });
  return NextResponse.json({ ok: true });
}
