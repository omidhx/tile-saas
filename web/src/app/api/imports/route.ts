import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { checkRateAsync, tooMany } from "@/auth/rateLimit";
import { z } from "zod";
import { id, parse } from "@/lib/validate";
import { applySnapshot, type SnapshotRow } from "@/db/imports";

const MAX_ROWS = 5000; // spec بخش ۸: محدودیت ردیف روی import

// ردیف‌ها را applySnapshot یکی‌یکی می‌سنجد و خطای هر ردیف را برمی‌گرداند؛ اینجا فقط پاکت.
// scope ناشناخته قبلاً به CHECKِ دیتابیس می‌خورد و ۵۰۰ می‌داد. بازنویسیِ ردیف‌ها فاز ۵ است.
const Body = z.object({
  tenantId: id,
  idempotencyKey: z.string().min(1),
  filename: z.string().optional(),
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("tenant") }),
    z.object({ type: z.literal("warehouse"), warehouseId: id }),
    z.object({ type: z.literal("brand"), brandId: id }),
  ]),
  rows: z.array(z.record(z.string(), z.unknown())),
});

/**
 * POST /api/imports — اعمالِ Snapshot موجودی (staff-only). ردیف‌ها به‌صورت JSON میان
 * (پارس اکسل سمتِ مرورگر انجام می‌شه، پس هیچ فایلی به سرور نمی‌رسه → سطحِ حمله‌ی
 * file-upload حذف). idempotencyKey اجباری تا re-submit امن باشه.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const p = parse(Body, body);
  if ("err" in p) return p.err;
  const { tenantId, scope, rows, idempotencyKey, filename } = p.data;
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: "too_many_rows" }, { status: 413 });

  // import سنگین است (تراکنش بلند روی کل scope) — سقفِ سخت‌گیرانه‌تر
  const rl = await checkRateAsync(`import:${userId}`, 10, 60 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const result = await applySnapshot({
    tenantId, uploaderUserId: userId, idempotencyKey, filename,
    scope, rows: rows as SnapshotRow[],
  });
  return NextResponse.json(result, { status: result.deduped ? 200 : 201 });
}
