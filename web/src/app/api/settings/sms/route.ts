import { NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/validate";
import { adminCtx } from "@/auth/httpCtx";
import { getSmsConfig, updateSmsConfig, SMS_NOTIFICATION_TYPES } from "@/db/smsConfig";
import { SMS_PROVIDERS } from "@/notify/smsProviders";

const providerIds = SMS_PROVIDERS.map((p) => p.id) as [(typeof SMS_PROVIDERS)[number]["id"], ...(typeof SMS_PROVIDERS)[number]["id"][]];
const Patch = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(providerIds).nullish(), // null = پاک‌کردنِ انتخاب
  senderNumber: z.string().optional(), apiKey: z.string().optional(),
  username: z.string().optional(), password: z.string().optional(),
  patterns: z.partialRecord(
    z.enum(SMS_NOTIFICATION_TYPES), z.object({ patternCode: z.string(), paramNames: z.string().optional() }),
  ).optional(),
});

/** GET/PATCH پنلِ پیامکیِ کارخانه (provider/کلید/شماره/پترن‌ها). admin-only، مثلِ بقیه‌ی تنظیماتِ کارخانه. */
export async function GET(req: Request) {
  const c = await adminCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  return NextResponse.json({ config: await getSmsConfig(c.tenantId), providers: SMS_PROVIDERS });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const p = parse(Patch, body);
  if ("err" in p) return p.err;

  await updateSmsConfig({ tenantId: c.tenantId, actorUserId: c.userId, ...p.data });
  return NextResponse.json({ ok: true });
}
