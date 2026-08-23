import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { sql } from "@/db/client";
import { metrics } from "@/lib/metrics";

/**
 * GET /api/metrics — metrics عملیاتی.
 *
 * فقط در production و فقط برای admin در دسترس است.
 * در dev و test هم در دسترس است ولی فقط برای دیباگ.
 *
 * شامل:
 *   - request count per route
 *   - latency (avg, min, max) per route
 *   - 4xx/5xx count
 *   - error rate
 *   - uptime
 *   - DB connection pool status (if available)
 */
export async function GET() {
  // در production، فقط platform admin یا staff admin
  if (process.env.NODE_ENV === "production") {
    const userId = await currentUserId();
    if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

    const [user] = await sql<{ is_platform_admin: boolean }[]>`
      SELECT is_platform_admin FROM app_user WHERE id = ${userId}`;
    if (!user?.is_platform_admin) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json(metrics.toJSON(), { status: 200 });
}
