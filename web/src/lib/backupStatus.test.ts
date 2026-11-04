import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We need to set BACKUP_STATUS_PATH BEFORE importing the module under test,
// because the path is captured at module-load time.
const TMP_DIR = mkdtempSync(join(tmpdir(), "backup-status-test-"));
const STATUS_FILE = join(TMP_DIR, "backup-status.json");

process.env.BACKUP_STATUS_PATH = STATUS_FILE;

// Dynamic import via require() so env var is set first
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readBackupStatus, computeLiveBackupAgeSeconds } = require("./backupStatus") as typeof import("./backupStatus");

// ──────────────────────────────────────────────
// readBackupStatus
// ──────────────────────────────────────────────

test("readBackupStatus: returns null when file does not exist", () => {
  rmSync(STATUS_FILE, { force: true });
  const status = readBackupStatus();
  assert.equal(status, null, "expected null when file does not exist");
});

test("readBackupStatus: returns null when file is invalid JSON", () => {
  writeFileSync(STATUS_FILE, "{ this is not valid json");
  const status = readBackupStatus();
  assert.equal(status, null, "expected null for invalid JSON");
});

test("readBackupStatus: returns null when retention_days is missing", () => {
  writeFileSync(
    STATUS_FILE,
    JSON.stringify({ last_success_at: "2026-01-01T00:00:00Z" }),
  );
  const status = readBackupStatus();
  assert.equal(status, null, "expected null when retention_days missing");
});

test("readBackupStatus: parses a valid full status file", () => {
  writeFileSync(
    STATUS_FILE,
    JSON.stringify({
      last_success_at: "2026-08-24T03:00:42Z",
      last_failure_at: null,
      last_failure_reason: null,
      last_success_size_bytes: 1234567,
      last_success_sha256: "abc123def456",
      backup_age_seconds: 0,
      restore_test_last_success_at: "2026-08-24T03:15:21Z",
      restore_test_last_failure_at: null,
      retention_days: 30,
    }),
  );

  const status = readBackupStatus();
  assert.notEqual(status, null);
  assert.equal(status!.last_success_at, "2026-08-24T03:00:42Z");
  assert.equal(status!.last_success_size_bytes, 1234567);
  assert.equal(status!.last_success_sha256, "abc123def456");
  assert.equal(status!.retention_days, 30);
  assert.equal(status!.restore_test_last_success_at, "2026-08-24T03:15:21Z");
  assert.equal(status!.last_failure_at, null);
});

test("readBackupStatus: handles partial fields gracefully", () => {
  // Some fields missing — should still parse with null for missing ones
  writeFileSync(
    STATUS_FILE,
    JSON.stringify({
      last_success_at: "2026-08-24T03:00:42Z",
      retention_days: 14,
    }),
  );

  const status = readBackupStatus();
  assert.notEqual(status, null);
  assert.equal(status!.last_success_at, "2026-08-24T03:00:42Z");
  assert.equal(status!.retention_days, 14);
  assert.equal(status!.last_failure_at, null);
  assert.equal(status!.last_success_size_bytes, null);
});

test("readBackupStatus: handles failure-only status", () => {
  // Backup script writes a failure-only status on the very first run
  writeFileSync(
    STATUS_FILE,
    JSON.stringify({
      last_success_at: null,
      last_failure_at: "2026-08-24T03:00:42Z",
      last_failure_reason: "pg_dump_too_small",
      last_success_size_bytes: null,
      last_success_sha256: null,
      backup_age_seconds: null,
      restore_test_last_success_at: null,
      restore_test_last_failure_at: null,
      retention_days: 30,
    }),
  );

  const status = readBackupStatus();
  assert.notEqual(status, null);
  assert.equal(status!.last_success_at, null);
  assert.equal(status!.last_failure_at, "2026-08-24T03:00:42Z");
  assert.equal(status!.last_failure_reason, "pg_dump_too_small");
  assert.equal(status!.retention_days, 30);
});

test("readBackupStatus: rejects non-object JSON (array)", () => {
  writeFileSync(STATUS_FILE, JSON.stringify([1, 2, 3]));
  const status = readBackupStatus();
  assert.equal(status, null, "arrays should not be valid status");
});

// ──────────────────────────────────────────────
// computeLiveBackupAgeSeconds
// ──────────────────────────────────────────────

test("computeLiveBackupAgeSeconds: returns null for null status", () => {
  const age = computeLiveBackupAgeSeconds(null);
  assert.equal(age, null);
});

test("computeLiveBackupAgeSeconds: returns null when last_success_at is null", () => {
  const age = computeLiveBackupAgeSeconds({
    last_success_at: null,
    last_failure_at: null,
    last_failure_reason: null,
    last_success_size_bytes: null,
    last_success_sha256: null,
    backup_age_seconds: null,
    restore_test_last_success_at: null,
    restore_test_last_failure_at: null,
    retention_days: 30,
  });
  assert.equal(age, null);
});

test("computeLiveBackupAgeSeconds: returns 0 for just-now timestamp", () => {
  const now = new Date().toISOString();
  const age = computeLiveBackupAgeSeconds({
    last_success_at: now,
    last_failure_at: null,
    last_failure_reason: null,
    last_success_size_bytes: 1000,
    last_success_sha256: "abc",
    backup_age_seconds: 0,
    restore_test_last_success_at: null,
    restore_test_last_failure_at: null,
    retention_days: 30,
  });
  // Should be 0 or very small (under 2 seconds for test slowness)
  assert.ok(age !== null, "age should not be null");
  assert.ok(age! < 5, `age should be small (< 5s), got ${age}`);
});

test("computeLiveBackupAgeSeconds: returns positive number for past timestamp", () => {
  // 1 hour ago
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const age = computeLiveBackupAgeSeconds({
    last_success_at: oneHourAgo,
    last_failure_at: null,
    last_failure_reason: null,
    last_success_size_bytes: 1000,
    last_success_sha256: "abc",
    backup_age_seconds: 0,
    restore_test_last_success_at: null,
    restore_test_last_failure_at: null,
    retention_days: 30,
  });
  assert.ok(age !== null);
  assert.ok(age! >= 3500, `age should be ~3600s, got ${age}`);
  assert.ok(age! <= 3700, `age should be ~3600s, got ${age}`);
});

test("computeLiveBackupAgeSeconds: returns null for unparseable timestamp", () => {
  const age = computeLiveBackupAgeSeconds({
    last_success_at: "not-a-date",
    last_failure_at: null,
    last_failure_reason: null,
    last_success_size_bytes: 1000,
    last_success_sha256: "abc",
    backup_age_seconds: 0,
    restore_test_last_success_at: null,
    restore_test_last_failure_at: null,
    retention_days: 30,
  });
  assert.equal(age, null);
});

// ──────────────────────────────────────────────
// Cleanup
// ──────────────────────────────────────────────

test("cleanup", () => {
  rmSync(TMP_DIR, { force: true, recursive: true });
});
