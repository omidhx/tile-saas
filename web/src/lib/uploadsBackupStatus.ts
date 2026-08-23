// =============================================================================
// web/src/lib/uploadsBackupStatus.ts — Read uploads backup status file
// =============================================================================
// این ماژول فایلِ status را برایِ uploads backup می‌خواند (مانندِ backupStatus.ts
// ولی برایِ فایل‌های private/uploads/).
// =============================================================================

import { readFileSync } from "node:fs";

const UPLOADS_STATUS_PATH =
  process.env.UPLOADS_STATUS_PATH ?? "/app/uploads-backups-status/uploads-backup-status.json";

export type UploadsBackupStatus = {
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  last_success_size_bytes: number | null;
  last_success_sha256: string | null;
  last_success_file_count: number | null;
  backup_age_seconds: number | null;
  restore_test_last_success_at: string | null;
  restore_test_last_failure_at: string | null;
  retention_days: number;
};

export function readUploadsBackupStatus(): UploadsBackupStatus | null {
  try {
    const raw = readFileSync(UPLOADS_STATUS_PATH, "utf8");
    const parsed = JSON.parse(raw);

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
      last_success_file_count:
        typeof parsed.last_success_file_count === "number" ? parsed.last_success_file_count : null,
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
    return null;
  }
}

export function computeUploadsBackupAgeSeconds(
  status: UploadsBackupStatus | null,
): number | null {
  if (!status?.last_success_at) return null;
  const then = Date.parse(status.last_success_at);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then) / 1000));
}
