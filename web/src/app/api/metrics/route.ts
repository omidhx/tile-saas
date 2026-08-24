import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { sql } from "@/db/client";
import { metrics } from "@/lib/metrics";
import { readBackupStatus, computeLiveBackupAgeSeconds } from "@/lib/backupStatus";
import { readUploadsBackupStatus, computeUploadsBackupAgeSeconds } from "@/lib/uploadsBackupStatus";

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
 *   - backup status (last success, age, restore test) — Phase 8
 *   - uploads backup status (AUD-009) — Phase 9
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

  const base = metrics.toJSON();

  // Phase 8 — backup status (read from mounted volume, no secrets exposed)
  const backupStatus = readBackupStatus();
  const backupSection = backupStatus
    ? {
        last_success_at: backupStatus.last_success_at,
        last_failure_at: backupStatus.last_failure_at,
        last_failure_reason: backupStatus.last_failure_reason,
        last_success_size_bytes: backupStatus.last_success_size_bytes,
        last_success_sha256: backupStatus.last_success_sha256
          ? backupStatus.last_success_sha256.substring(0, 16) + "..."
          : null,
        backup_age_seconds: computeLiveBackupAgeSeconds(backupStatus),
        restore_test_last_success_at: backupStatus.restore_test_last_success_at,
        restore_test_last_failure_at: backupStatus.restore_test_last_failure_at,
        retention_days: backupStatus.retention_days,
      }
    : { configured: false, reason: "backup-status.json not found or unreadable" };

  // Phase 9 — uploads backup status (AUD-009)
  const uploadsStatus = readUploadsBackupStatus();
  const uploadsSection = uploadsStatus
    ? {
        last_success_at: uploadsStatus.last_success_at,
        last_failure_at: uploadsStatus.last_failure_at,
        last_failure_reason: uploadsStatus.last_failure_reason,
        last_success_size_bytes: uploadsStatus.last_success_size_bytes,
        last_success_sha256: uploadsStatus.last_success_sha256
          ? uploadsStatus.last_success_sha256.substring(0, 16) + "..."
          : null,
        last_success_file_count: uploadsStatus.last_success_file_count,
        backup_age_seconds: computeUploadsBackupAgeSeconds(uploadsStatus),
        restore_test_last_success_at: uploadsStatus.restore_test_last_success_at,
        restore_test_last_failure_at: uploadsStatus.restore_test_last_failure_at,
        retention_days: uploadsStatus.retention_days,
      }
    : { configured: false, reason: "uploads-backup-status.json not found or unreadable" };

  return NextResponse.json(
    { ...base, backup: backupSection, uploads_backup: uploadsSection },
    { status: 200 },
  );
}
