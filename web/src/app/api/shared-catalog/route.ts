import { NextResponse } from "next/server";
import { z } from "zod";
import { id as uuid, count, parse } from "@/lib/validate";
import { randomBytes } from "node:crypto";
import { agentCtx } from "@/auth/httpCtx";
import { listCatalogs, listPickableVariants, getTenantSlug, createCatalog, updateCatalog, setCatalogActive, deleteCatalog } from "@/db/sharedCatalog";
import type { CatalogItemInput } from "@/db/sharedCatalog";

// قیمت اختیاری است؛ اگر آمد باید عددِ صحیحِ نامنفی باشد (قانون ۷)
const Items = z.array(z.object({ variantId: uuid, customerPrice: count.nullish() })).min(1);
const Target = z.object({ id: uuid });
const Active = z.object({ id: uuid, isActive: z.boolean() });

/** اعتبارسنجیِ آرایه‌ی آیتم‌ها از بدنه‌ی درخواست. null یعنی نامعتبر. */
function parseItems(raw: unknown): CatalogItemInput[] | null {
  const r = Items.safeParse(raw);
  return r.success ? r.data.map((it) => ({ variantId: it.variantId, customerPrice: it.customerPrice ?? null })) : null;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await agentCtx(u.searchParams.get("tenantId"), u.searchParams.get("agentAccountId"));
  if ("err" in c) return c.err;
  // کاتالوگ‌ها + محصول‌های قابلِ‌انتخاب در یک درخواست — صفحه‌ی سازنده هر دو را می‌خواهد
  const [catalogs, products, slug] = await Promise.all([
    listCatalogs(c.tenantId, c.agentAccountId),
    listPickableVariants(c.tenantId),
    getTenantSlug(c.tenantId),
  ]);
  return NextResponse.json({ catalogs, products, slug });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await agentCtx(body?.tenantId, body?.agentAccountId);
  if ("err" in c) return c.err;

  const { title } = body ?? {};
  if (typeof title !== "string" || !title.trim())
    return NextResponse.json({ error: "missing_title" }, { status: 400 });
  const items = parseItems(body?.items);
  if (!items) return NextResponse.json({ error: "no_items" }, { status: 400 });

  // token = ظرفیتِ دسترسیِ غیرقابل‌حدس. base64url تا در URL امن باشد.
  const token = randomBytes(18).toString("base64url");
  const { id } = await createCatalog({
    tenantId: c.tenantId, agentAccountId: c.agentAccountId, title, items, token,
    showDetails: body?.showDetails === true,
  });
  return NextResponse.json({ id, token }, { status: 201 });
}

/**
 * PATCH دو کار، بسته به بدنه:
 *   { id, isActive }        → باطل/فعال‌کردنِ لینک
 *   { id, title, items }    → ویرایشِ عنوان و آیتم‌ها (token دست‌نخورده می‌ماند)
 */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await agentCtx(body?.tenantId, body?.agentAccountId);
  if ("err" in c) return c.err;
  const t = parse(Target, body);
  if ("err" in t) return t.err;

  if ("items" in body || "title" in body) {
    if (typeof body.title !== "string" || !body.title.trim())
      return NextResponse.json({ error: "missing_title" }, { status: 400 });
    const items = parseItems(body.items);
    if (!items) return NextResponse.json({ error: "no_items" }, { status: 400 });
    await updateCatalog({
      tenantId: c.tenantId, agentAccountId: c.agentAccountId, id: t.data.id, title: body.title, items,
      showDetails: body.showDetails === true,
    });
    return NextResponse.json({ ok: true });
  }

  const a = parse(Active, body);
  if ("err" in a) return a.err;
  await setCatalogActive({ tenantId: c.tenantId, agentAccountId: c.agentAccountId, ...a.data });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await agentCtx(body?.tenantId, body?.agentAccountId);
  if ("err" in c) return c.err;
  const t = parse(Target, body);
  if ("err" in t) return t.err;

  await deleteCatalog({ tenantId: c.tenantId, agentAccountId: c.agentAccountId, id: t.data.id });
  return NextResponse.json({ ok: true });
}
