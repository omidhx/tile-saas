import { NextResponse } from "next/server";
import { z } from "zod";
import { positive, parse } from "@/lib/validate";
import { adminCtx } from "@/auth/httpCtx";
import { getTenantSettings, updateTenantSettings } from "@/db/tenantSettings";
import { isSafeImageUrl } from "@/lib/url";

const Patch = z.object({
  ttlHours: positive.max(8760).optional(), // ≤ یک سال؛ بزرگ‌تر make_interval/timestamp را می‌ترکاند
  logoUrl: z.string().refine(isSafeImageUrl).nullish(),
  currencyUnit: z.enum(["rial", "toman"]).optional(),
});

/** GET/PATCH تنظیماتِ کارخانه (TTLِ پیش‌فرضِ رزرو + لوگو). admin-only. */
export async function GET(req: Request) {
  const c = await adminCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const settings = await getTenantSettings(c.tenantId);
  if (!settings) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(settings);
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const p = parse(Patch, body);
  if ("err" in p) return p.err;

  // logoUrl: نبودن=دست‌نزن، null=پاک‌کن
  await updateTenantSettings({ tenantId: c.tenantId, actorUserId: c.userId, ...p.data });
  return NextResponse.json({ ok: true });
}
