// =============================================================================
// web/src/lib/backupStatus.ts — Read backup status file (mounted volume)
// =============================================================================
// این ماژول فایلِ status را از یک mount point داخلِ container می‌خواند و
// آن را به‌صورتِ ساختاریافته در اختیارِ /api/metrics قرار می‌دهد.
//
// فایل توسط `scripts/backup-db.sh` و `scripts/restore-db.sh` نوشته می‌شود و
// توسطِ docker-compose به‌صورتِ read-only داخلِ container mount می‌شود.
//
// ⚠️ این فایل فقط metadata دارد (timestamp, size, checksum). هرگز شاملِ
// مسیرِ فایل، نامِ bucket، credentials یا passphrase نیست.
//
// اگر فایل وجود نداشت یا parse نشد، null برمی‌گرداند — یعنی `/api/metrics`
// فیلدِ backup را گزارش نمی‌کند ولی همچنان ۲۰۰ برمی‌گرداند.
// =============================================================================

import { readFileSync } from "node:fs";

// مسیر mount point داخلِ container.
// در docker-compose.yml این تنظیم است:
//   ./backups/status:/app/backups-status:ro
// متغیرِ محیطی BACKUP_STATUS_PATH برای override (تست، environments دیگر).
const BACKUP_STATUS_PATH =
  process.env.BACKUP_STATUS_PATH ?? "/app/backups-status/backup-status.json";

export type BackupStatus = {
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  last_success_size_bytes: number | null;
  last_success_sha256: string | null;
  backup_age_seconds: number | null;
  restore_test_last_success_at: string | null;
  restore_test_last_failure_at: string | null;
  retention_days: number;
};

/**
 * Read the backup status file.
 *
 * Returns null if:
 *   - File does not exist (backups not yet configured)
 *   - File is invalid JSON
 *   - File cannot be read (permission denied, etc.)
 *
 * This is intentionally non-throwing — metrics endpoint must remain robust
 * even if the backup system has never run.
 */
export function readBackupStatus(): BackupStatus | null {
  try {
    const raw = readFileSync(BACKUP_STATUS_PATH, "utf8");
    const parsed = JSON.parse(raw);

    // Validate required fields; return null if structure is wrong
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.retention_days !== "number") return null;

    return {
      last_success_at: typeof parsed.last_success_at === "string" ? parsed.last_success_at : null,
      last_failure_at: typeof parsed.last_failure_at === "string" ? parsed.last_failure_at : null,
      last_failure_reason:
        typeof parsed.last_failure_reason === "string" ? parsed.last_failure_reason : null,
      last_success_size_bytes:
        typeof parsed.last_success_size_bytes === "number" ? parsed.last_success_size_bytes : null,
      last_success_sha256:
        typeof parsed.last_success_sha256 === "string" ? parsed.last_success_sha256 : null,
      backup_age_seconds:
        typeof parsed.backup_age_seconds === "number" ? parsed.backup_age_seconds : null,
      restore_test_last_success_at:
        typeof parsed.restore_test_last_success_at === "string"
          ? parsed.restore_test_last_success_at
          : null,
      restore_test_last_failure_at:
        typeof parsed.restore_test_last_failure_at === "string"
          ? parsed.restore_test_last_failure_at
          : null,
      retention_days: parsed.retention_days,
    };
  } catch {
    // File does not exist, or parse failed, or permission denied
    return null;
  }
}

/**
 * Compute the backup age in seconds from the last_success_at timestamp.
 * This is the "live" age — different from the `backup_age_seconds` field
 * stored in the status file (which is computed at backup time, so it's
 * always 0).
 *
 * Returns null if last_success_at is null or cannot be parsed.
 */
export function computeLiveBackupAgeSeconds(status: BackupStatus | null): number | null {
  if (!status?.last_success_at) return null;
  const then = Date.parse(status.last_success_at);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 1000));
}
