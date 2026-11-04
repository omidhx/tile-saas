import { NextResponse } from "next/server";
import { sql } from "@/db/client";

/**
 * GET /api/ready — Readiness probe.
 *
 * بررسی می‌کند که سرویس واقعاً می‌تواند request معتبر پاسخ دهد.
 * اگر DB در دسترس نباشد، 503 برمی‌گرداند (load balancer ترافیک را نمی‌فرستد).
 *
 * تفاوت با /api/health:
 *   - /api/health (liveness): فقط process زنده است — DB چک نمی‌شود
 *   - /api/ready (readiness): DB و dependencies چک می‌شوند
 *
 * این endpoint احراز هویت لازم ندارد و اطلاعات حساسی نمی‌دهد.
 */
export async function GET() {
  const checks: Record<string, "ok" | "fail"> = {};
  let allOk = true;

  // ۱. بررسی DB — کوئری سبک
  try {
    const [row] = await sql<{ ok: number }[]>`SELECT 1 AS ok`;
    if (!row || row.ok !== 1) {
      checks.db = "fail";
      allOk = false;
    } else {
      checks.db = "ok";
    }
  } catch {
    checks.db = "fail";
    allOk = false;
  }

  // نتیجه
  if (allOk) {
    return NextResponse.json(
      { status: "ready", checks, timestamp: new Date().toISOString() },
      { status: 200 },
    );
  }
  return NextResponse.json(
    { status: "not_ready", checks, timestamp: new Date().toISOString() },
    { status: 503 },
  );
}
