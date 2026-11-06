import { NextResponse } from "next/server";
import { z } from "zod";
import { id, parse } from "@/lib/validate";
import { staffCtx, adminCtx } from "@/auth/httpCtx";
import { listWarehouses, createWarehouse, updateWarehouse, deleteWarehouse } from "@/db/warehouses";

/** GET /api/warehouses?tenantId — انبارهای tenant (برای انتخاب scope در import، و صفحه‌ی مدیریت). */
export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  return NextResponse.json({ warehouses: await listWarehouses(c.tenantId) });
}

const nonBlank = z.string().trim().min(1);
const Create = z.object({ name: nonBlank, code: nonBlank, type: z.enum(["main", "regional", "in_transit"]) });
const Update = z.object({ warehouseId: id, name: z.string().optional(), code: z.string().optional() });
const Remove = z.object({ warehouseId: id });

/** POST /api/warehouses — انبارِ تازه. admin-only. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const auth = await adminCtx(body?.tenantId);
  if ("err" in auth) return auth.err;
  const p = parse(Create, body);
  if ("err" in p) return p.err;

  const r = await createWarehouse({ tenantId: auth.tenantId, ...p.data });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
}

/** PATCH /api/warehouses — تغییرِ نام/کد. admin-only. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const auth = await adminCtx(body?.tenantId);
  if ("err" in auth) return auth.err;
  const p = parse(Update, body);
  if ("err" in p) return p.err;

  const r = await updateWarehouse({ tenantId: auth.tenantId, ...p.data });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/warehouses — حذفِ واقعی، فقط اگر انبار هیچ سابقه‌ای ندارد. admin-only. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const auth = await adminCtx(body?.tenantId);
  if ("err" in auth) return auth.err;
  const p = parse(Remove, body);
  if ("err" in p) return p.err;

  const r = await deleteWarehouse({ tenantId: auth.tenantId, warehouseId: p.data.warehouseId });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
