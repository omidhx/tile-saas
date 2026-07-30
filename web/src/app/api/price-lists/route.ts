import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaffPage, AuthzError } from "@/auth/authz";
import { createPriceList } from "@/db/pricing";

/** POST {tenantId, name} — ساختِ سبدِ قیمت‌گذاریِ تازه (staff، pageKey=prices). تا حالا فقط SQL. */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { tenantId, name } = body ?? {};
  if (typeof tenantId !== "string" || typeof name !== "string" || !name.trim())
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  try {
    await authorizeStaffPage(userId, tenantId, "prices");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const list = await createPriceList(tenantId, name);
  return NextResponse.json({ list }, { status: 201 });
}
