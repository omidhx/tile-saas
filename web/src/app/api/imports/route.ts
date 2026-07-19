import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { checkRate, tooMany } from "@/auth/rateLimit";
import { applySnapshot, type SnapshotRow, type ImportScope } from "@/db/imports";

const MAX_ROWS = 5000; // spec بخش ۸: محدودیت ردیف روی import

/**
 * POST /api/imports — اعمالِ Snapshot موجودی (staff-only). ردیف‌ها به‌صورت JSON میان
 * (پارس اکسل سمتِ مرورگر انجام می‌شه، پس هیچ فایلی به سرور نمی‌رسه → سطحِ حمله‌ی
 * file-upload حذف). idempotencyKey اجباری تا re-submit امن باشه.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { tenantId, scope, rows, idempotencyKey, filename } = body ?? {};
  if (typeof tenantId !== "string" || typeof idempotencyKey !== "string" || !Array.isArray(rows) || !scope?.type)
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: "too_many_rows" }, { status: 413 });

  // import سنگین است (تراکنش بلند روی کل scope) — سقفِ سخت‌گیرانه‌تر
  const rl = checkRate(`import:${userId}`, 10, 60 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const result = await applySnapshot({
    tenantId, uploaderUserId: userId, idempotencyKey, filename,
    scope: scope as ImportScope, rows: rows as SnapshotRow[],
  });
  return NextResponse.json(result, { status: result.deduped ? 200 : 201 });
}
