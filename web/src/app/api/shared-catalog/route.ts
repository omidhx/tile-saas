import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { currentUserId } from "@/auth/session";
import { authorizeAgent, AuthzError } from "@/auth/authz";
import { listCatalogs, listPickableVariants, getTenantSlug, createCatalog, setCatalogActive, deleteCatalog } from "@/db/sharedCatalog";

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

  const { title, variantIds } = body ?? {};
  if (typeof title !== "string" || !title.trim())
    return NextResponse.json({ error: "missing_title" }, { status: 400 });
  if (!Array.isArray(variantIds) || variantIds.length === 0 || !variantIds.every((v) => typeof v === "string"))
    return NextResponse.json({ error: "no_items" }, { status: 400 });

  // token = ظرفیتِ دسترسیِ غیرقابل‌حدس. base64url تا در URL امن باشد.
  const token = randomBytes(18).toString("base64url");
  const { id } = await createCatalog({
    tenantId: c.tenantId, agentAccountId: c.agentAccountId, title, variantIds, token,
  });
  return NextResponse.json({ id, token }, { status: 201 });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await agentCtx(body?.tenantId, body?.agentAccountId);
  if ("err" in c) return c.err;
  if (typeof body?.id !== "string" || typeof body?.isActive !== "boolean")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

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
