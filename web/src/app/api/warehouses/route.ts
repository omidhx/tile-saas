import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, authorizeAdmin, AuthzError } from "@/auth/authz";
import { listWarehouses, createWarehouse, updateWarehouse } from "@/db/warehouses";

/** GET /api/warehouses?tenantId — انبارهای tenant (برای انتخاب scope در import، و صفحه‌ی مدیریت). */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const tenantId = new URL(req.url).searchParams.get("tenantId") ?? "";
  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
  return NextResponse.json({ warehouses: await listWarehouses(tenantId) });
}

async function requireAdmin(tenantId: string) {
  const userId = await currentUserId();
  if (!userId) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  try {
    await authorizeAdmin(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    throw e;
  }
  return { userId };
}

const TYPES = ["main", "regional", "in_transit"];

/** POST /api/warehouses — انبارِ تازه. admin-only. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, name, code, type } = body ?? {};
  if (typeof tenantId !== "string" || typeof name !== "string" || !name.trim()
    || typeof code !== "string" || !code.trim() || !TYPES.includes(type))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await requireAdmin(tenantId);
  if (auth.error) return auth.error;

  const r = await createWarehouse({ tenantId, name: name.trim(), code: code.trim(), type });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
}

/** PATCH /api/warehouses — تغییرِ نام/کد. admin-only (بدونِ حذف — inventory_lot به انبار FK دارد). */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, warehouseId, name, code } = body ?? {};
  if (typeof tenantId !== "string" || typeof warehouseId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await requireAdmin(tenantId);
  if (auth.error) return auth.error;

  const r = await updateWarehouse({ tenantId, warehouseId, name, code });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
