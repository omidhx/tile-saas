import { NextResponse } from "next/server";
import { z } from "zod";
import { parse } from "@/lib/validate";
import { staffCtx, adminCtx } from "@/auth/httpCtx";
import { getFeatures, setFeatures } from "@/db/features";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/features";

// فقط کلیدهای شناخته‌شده، مقدار boolean، و حداقل یک تغییر.
const Put = z.object({
  changes: z.partialRecord(z.enum(FEATURE_KEYS as [FeatureKey, ...FeatureKey[]]), z.boolean())
    .refine((c) => Object.keys(c).length > 0),
});

/** GET ?tenantId — امکاناتِ کارخانه. پنلِ پشتیبان با این تب‌ها و پنل‌ها را نشان می‌دهد. */
export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  return NextResponse.json({ features: await getFeatures(c.tenantId) });
}

/** PUT {tenantId, changes: {key: boolean}} — فقط مدیرِ همین کارخانه. */
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const p = parse(Put, body);
  if ("err" in p) return p.err;

  const features = await setFeatures({ tenantId: c.tenantId, actorUserId: c.userId, changes: p.data.changes });
  return NextResponse.json({ features });
}
