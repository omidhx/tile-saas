import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { currentUserId } from "@/auth/session";
import { authorizeAgent, AuthzError } from "@/auth/authz";
import { listCatalogs, listPickableVariants, getTenantSlug, createCatalog, updateCatalog, setCatalogActive, deleteCatalog } from "@/db/sharedCatalog";
import type { CatalogItemInput } from "@/db/sharedCatalog";

/** اعتبارسنجیِ آرایه‌ی آیتم‌ها از بدنه‌ی درخواست. null یعنی نامعتبر. */
function parseItems(raw: unknown): CatalogItemInput[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: CatalogItemInput[] = [];
  for (const it of raw) {
    if (!it || typeof it.variantId !== "string") return null;
    const cp = it.customerPrice;
    // قیمت اختیاری است؛ اگر آمد باید عددِ صحیحِ نامنفی باشد
    if (cp != null && (typeof cp !== "number" || !Number.isInteger(cp) || cp < 0)) return null;
    out.push({ variantId: it.variantId, customerPrice: cp == null ? null : cp });
  }
  return out;
}

// کاتالوگ را نماینده برای مشتریِ خودش می‌سازد — پس دسترسیِ نماینده لازم است.
async function agentCtx(tenantId: unknown, agentAccountId: unknown) {
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
  const body = await req.json().catch(() => ({}));
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
  const body = await req.json().catch(() => ({}));
  const c = await agentCtx(body?.tenantId, body?.agentAccountId);
  if ("err" in c) return c.err;
  if (typeof body?.id !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });

  if ("items" in body || "title" in body) {
    if (typeof body.title !== "string" || !body.title.trim())
      return NextResponse.json({ error: "missing_title" }, { status: 400 });
    const items = parseItems(body.items);
    if (!items) return NextResponse.json({ error: "no_items" }, { status: 400 });
    await updateCatalog({
      tenantId: c.tenantId, agentAccountId: c.agentAccountId, id: body.id, title: body.title, items,
      showDetails: body.showDetails === true,
    });
    return NextResponse.json({ ok: true });
  }

  if (typeof body.isActive !== "boolean") return NextResponse.json({ error: "invalid" }, { status: 400 });
  await setCatalogActive({ tenantId: c.tenantId, agentAccountId: c.agentAccountId, id: body.id, isActive: body.isActive });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await agentCtx(body?.tenantId, body?.agentAccountId);
  if ("err" in c) return c.err;
  if (typeof body?.id !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });

  await deleteCatalog({ tenantId: c.tenantId, agentAccountId: c.agentAccountId, id: body.id });
  return NextResponse.json({ ok: true });
}
