import { NextResponse } from "next/server";
import { staffCtx, adminCtx } from "@/auth/httpCtx";
import { listWarehouses, createWarehouse, updateWarehouse, deleteWarehouse } from "@/db/warehouses";

/** GET /api/warehouses?tenantId — انبارهای tenant (برای انتخاب scope در import، و صفحه‌ی مدیریت). */
export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  return NextResponse.json({ warehouses: await listWarehouses(c.tenantId) });
}

const TYPES = ["main", "regional", "in_transit"];

/** POST /api/warehouses — انبارِ تازه. admin-only. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, name, code, type } = body ?? {};
  if (typeof tenantId !== "string" || typeof name !== "string" || !name.trim()
    || typeof code !== "string" || !code.trim() || !TYPES.includes(type))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await adminCtx(tenantId);
  if ("err" in auth) return auth.err;

  const r = await createWarehouse({ tenantId, name: name.trim(), code: code.trim(), type });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
}

/** PATCH /api/warehouses — تغییرِ نام/کد. admin-only. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, warehouseId } = body ?? {};
  if (typeof tenantId !== "string" || typeof warehouseId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await adminCtx(tenantId);
  if ("err" in auth) return auth.err;

  // نوعِ غلط (مثلاً عدد) به‌جای بی‌صدا نوشتنِ داده‌ی غلط یا ترکیدنِ کوئری، نادیده گرفته می‌شود.
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const r = await updateWarehouse({ tenantId, warehouseId, name: str(body.name), code: str(body.code) });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/warehouses — حذفِ واقعی، فقط اگر انبار هیچ سابقه‌ای ندارد. admin-only. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, warehouseId } = body ?? {};
  if (typeof tenantId !== "string" || typeof warehouseId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await adminCtx(tenantId);
  if ("err" in auth) return auth.err;

  const r = await deleteWarehouse({ tenantId, warehouseId });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
