import { NextResponse } from "next/server";
import { adminCtx } from "@/auth/httpCtx";
import { getSmsConfig, updateSmsConfig, SMS_NOTIFICATION_TYPES } from "@/db/smsConfig";
import { SMS_PROVIDERS } from "@/notify/smsProviders";

/** GET/PATCH پنلِ پیامکیِ کارخانه (provider/کلید/شماره/پترن‌ها). admin-only، مثلِ بقیه‌ی تنظیماتِ کارخانه. */
export async function GET(req: Request) {
  const c = await adminCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  return NextResponse.json({ config: await getSmsConfig(c.tenantId), providers: SMS_PROVIDERS });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { enabled, provider, senderNumber, apiKey, username, password, patterns } = body ?? {};
  if (provider !== undefined && provider !== null && !SMS_PROVIDERS.some((p) => p.id === provider))
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  if (patterns !== undefined) {
    if (typeof patterns !== "object" || patterns === null)
      return NextResponse.json({ error: "invalid" }, { status: 400 });
    for (const key of Object.keys(patterns))
      if (!SMS_NOTIFICATION_TYPES.includes(key as (typeof SMS_NOTIFICATION_TYPES)[number]))
        return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  await updateSmsConfig({
    tenantId: c.tenantId, actorUserId: c.userId,
    enabled: typeof enabled === "boolean" ? enabled : undefined,
    provider: provider === undefined ? undefined : provider,
    senderNumber: typeof senderNumber === "string" ? senderNumber : undefined,
    apiKey: typeof apiKey === "string" ? apiKey : undefined,
    username: typeof username === "string" ? username : undefined,
    password: typeof password === "string" ? password : undefined,
    patterns,
  });
  return NextResponse.json({ ok: true });
}
