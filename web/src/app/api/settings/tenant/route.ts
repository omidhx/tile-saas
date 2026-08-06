import { NextResponse } from "next/server";
import { adminCtx } from "@/auth/httpCtx";
import { getTenantSettings, updateTenantSettings } from "@/db/tenantSettings";

/** GET/PATCH تنظیماتِ کارخانه (TTLِ پیش‌فرضِ رزرو + لوگو). admin-only. */
export async function GET(req: Request) {
  const c = await adminCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  const settings = await getTenantSettings(c.tenantId);
  if (!settings) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(settings);
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { ttlHours, logoUrl, currencyUnit } = body ?? {};
  if (ttlHours !== undefined && (!Number.isInteger(ttlHours) || ttlHours <= 0))
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (logoUrl !== undefined && logoUrl !== null && typeof logoUrl !== "string")
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (currencyUnit !== undefined && currencyUnit !== "rial" && currencyUnit !== "toman")
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  await updateTenantSettings({
    tenantId: c.tenantId, actorUserId: c.userId,
    ttlHours: typeof ttlHours === "number" ? ttlHours : undefined,
    logoUrl,
    currencyUnit,
  });
  return NextResponse.json({ ok: true });
}
