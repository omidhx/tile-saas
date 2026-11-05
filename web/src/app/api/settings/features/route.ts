import { NextResponse } from "next/server";
import { staffCtx, adminCtx } from "@/auth/httpCtx";
import { getFeatures, setFeatures } from "@/db/features";
import { FEATURE_KEYS, type FeatureKey } from "@/lib/features";

/** GET ?tenantId — امکاناتِ کارخانه. پنلِ پشتیبان با این تب‌ها و پنل‌ها را نشان می‌دهد. */
export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  return NextResponse.json({ features: await getFeatures(c.tenantId) });
}

/** PUT {tenantId, changes: {key: boolean}} — فقط مدیرِ همین کارخانه. */
export async function PUT(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await adminCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const raw = body?.changes;
  if (!raw || typeof raw !== "object") return NextResponse.json({ error: "invalid" }, { status: 400 });
  const entries = Object.entries(raw);
  const valid = entries.length > 0 && entries.every(
    ([k, v]) => FEATURE_KEYS.includes(k as FeatureKey) && typeof v === "boolean");
  if (!valid) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const features = await setFeatures({
    tenantId: c.tenantId, actorUserId: c.userId,
    changes: Object.fromEntries(entries) as Partial<Record<FeatureKey, boolean>>,
  });
  return NextResponse.json({ features });
}
