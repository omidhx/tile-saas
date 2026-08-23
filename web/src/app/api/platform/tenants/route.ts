import { NextResponse } from "next/server";
import { platformAdminCtx } from "@/auth/httpCtx";
import { createTenant } from "@/db/platform";

/**
 * POST /api/platform/tenants — ساختِ کارخانه‌ی تازه + اولین مدیرش.
 * فقط مدیرِ پلتفرم (app_user.is_platform_admin) — نه admin هیچ tenantی.
 *
 * Rate limit: 20/min per user (platformAdminCtx)
 */
export async function POST(req: Request) {
  const c = await platformAdminCtx();
  if ("err" in c) return c.err;

  const body = await req.json().catch(() => ({}));
  const { name, slug, adminPhone, adminEmail, adminFullName } = body ?? {};
  if (typeof name !== "string" || typeof slug !== "string" || typeof adminPhone !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const r = await createTenant({
    name, slug, adminPhone,
    adminEmail: typeof adminEmail === "string" ? adminEmail : undefined,
    adminFullName: typeof adminFullName === "string" ? adminFullName : undefined,
  });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "invalid" ? 400 : 409 });
  return NextResponse.json({ tenantId: r.tenantId, tempPassword: r.tempPassword }, { status: 201 });
}
