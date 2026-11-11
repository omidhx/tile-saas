import { NextResponse } from "next/server";
import { z } from "zod";
import { staffCtx } from "@/auth/httpCtx";
import { checkRateAsync, tooMany } from "@/auth/rateLimit";
import { id, parse } from "@/lib/validate";
import { applySnapshot, undoImport, listImports } from "@/db/imports";
import { MAX_IMPORT_ROWS } from "@/lib/importRows";


// ردیف‌ها خامِ sheet_to_json هستند؛ تفسیرشان در lib/importRows.ts است.
const Body = z.object({
  tenantId: id,
  idempotencyKey: z.string().min(1),
  filename: z.string().optional(),
  preview: z.boolean().optional(),
  scope: z.discriminatedUnion("type", [
    z.object({ type: z.literal("tenant") }),
    z.object({ type: z.literal("warehouse"), warehouseId: id }),
    z.object({ type: z.literal("brand"), brandId: id }),
  ]),
  rows: z.array(z.record(z.string(), z.unknown())).max(MAX_IMPORT_ROWS),
});

/** GET /api/imports?tenantId — آخرین ایمپورت‌ها، برای برگرداندن. */
export async function GET(req: Request) {
  const c = await staffCtx(new URL(req.url).searchParams.get("tenantId"));
  if ("err" in c) return c.err;
  return NextResponse.json({ imports: await listImports(c.tenantId) });
}

/**
 * POST /api/imports — پیش‌نمایش (`preview: true`) یا اعمالِ Snapshot موجودی (staff).
 * فایل در مرورگر خوانده می‌شود و فقط ردیف‌ها می‌آیند. پیش‌نمایش ۲۰۰ می‌دهد، حتی با خطا.
 * اعمال: ۲۰۱، یا ۴۲۲ با فهرستِ خطاها و بدونِ هیچ تغییری.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Body, body);
  if ("err" in p) return p.err;
  const { scope, rows, idempotencyKey, filename, preview } = p.data;

  // اعمال تراکنشی روی کل scope است و balanceها را قفل می‌کند؛ پیش‌نمایش نه
  const rl = await checkRateAsync(`import${preview ? "-preview" : ""}:${c.userId}`, preview ? 60 : 10, 60 * 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  const r = await applySnapshot({ tenantId: c.tenantId, uploaderUserId: c.userId, idempotencyKey, filename, scope, rows, preview });
  if (r.errors.some((e) => e.reason === "scope_not_found")) return NextResponse.json({ error: "scope_not_found" }, { status: 404 });
  if (r.errors.some((e) => e.reason === "idempotency_mismatch")) return NextResponse.json({ error: "idempotency_mismatch" }, { status: 409 });
  const status = r.preview || r.deduped ? 200 : r.ok ? 201 : 422;
  return NextResponse.json(r, { status });
}

const Undo = z.object({ tenantId: id, batchId: id });
const UNDO_STATUS = { not_found: 404, not_committed: 409, not_latest: 409, below_committed: 409 } as const;

/** DELETE /api/imports — برگرداندنِ آخرین ایمپورتِ اعمال‌شده. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Undo, body);
  if ("err" in p) return p.err;
  const r = await undoImport({ tenantId: c.tenantId, userId: c.userId, batchId: p.data.batchId });
  if (!r.ok) return NextResponse.json({ error: r.reason, errors: r.errors }, { status: UNDO_STATUS[r.reason] });
  return NextResponse.json(r);
}
