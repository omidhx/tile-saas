import { NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/validate";
import { platformAdminCtx } from "@/auth/httpCtx";
import { createTenant } from "@/db/platform";

const Create = z.object({
  name: z.string(), slug: z.string(), adminPhone: z.string(),
  adminEmail: z.string().nullish(), adminFullName: z.string().nullish(),
});

/**
 * POST /api/platform/tenants — ساختِ کارخانه‌ی تازه + اولین مدیرش.
 * فقط مدیرِ پلتفرم (app_user.is_platform_admin) — نه admin هیچ tenantی.
 *
 * Rate limit: 20/min per user (platformAdminCtx)
 */
export async function POST(req: Request) {
  const c = await platformAdminCtx();
  if ("err" in c) return c.err;

  const p = parse(Create, await req.json().catch(() => null));
  if ("err" in p) return p.err;
  const { name, slug, adminPhone, adminEmail, adminFullName } = p.data;

  const r = await createTenant({ name, slug, adminPhone, adminEmail, adminFullName });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "invalid" ? 400 : 409 });
  return NextResponse.json({ tenantId: r.tenantId, tempPassword: r.tempPassword }, { status: 201 });
}
