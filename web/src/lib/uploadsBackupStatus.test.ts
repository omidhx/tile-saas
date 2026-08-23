import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TMP_DIR = mkdtempSync(join(tmpdir(), "uploads-backup-status-test-"));
const STATUS_FILE = join(TMP_DIR, "uploads-backup-status.json");

process.env.UPLOADS_STATUS_PATH = STATUS_FILE;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readUploadsBackupStatus, computeUploadsBackupAgeSeconds } = require("./uploadsBackupStatus") as typeof import("./uploadsBackupStatus");

// ──────────────────────────────────────────────
// readUploadsBackupStatus
// ──────────────────────────────────────────────

test("readUploadsBackupStatus: returns null when file does not exist", () => {
  rmSync(STATUS_FILE, { force: true });
  const status = readUploadsBackupStatus();
  assert.equal(status, null);
});

test("readUploadsBackupStatus: returns null when file is invalid JSON", () => {
  writeFileSync(STATUS_FILE, "{ invalid json");
  const status = readUploadsBackupStatus();
  assert.equal(status, null);
});

test("readUploadsBackupStatus: returns null when retention_days is missing", () => {
  writeFileSync(STATUS_FILE, JSON.stringify({ last_success_at: "2026-01-01T00:00:00Z" }));
  const status = readUploadsBackupStatus();
  assert.equal(status, null);
});

test("readUploadsBackupStatus: parses a valid full status file", () => {
  writeFileSync(
    STATUS_FILE,
    JSON.stringify({
      last_success_at: "2026-08-24T03:00:42Z",
      last_failure_at: null,
      last_failure_reason: null,
      last_success_size_bytes: 1234567,
      last_success_sha256: "abc123def456",
      last_success_file_count: 42,
      backup_age_seconds: 0,
      restore_test_last_success_at: "2026-08-24T03:15:21Z",
      restore_test_last_failure_at: null,
      retention_days: 30,
    }),
  );

  const status = readUploadsBackupStatus();
  assert.notEqual(status, null);
  assert.equal(status!.last_success_at, "2026-08-24T03:00:42Z");
  assert.equal(status!.last_success_size_bytes, 1234567);
  assert.equal(status!.last_success_sha256, "abc123def456");
  assert.equal(status!.last_success_file_count, 42);
  assert.equal(status!.retention_days, 30);
  assert.equal(status!.restore_test_last_success_at, "2026-08-24T03:15:21Z");
  assert.equal(status!.last_failure_at, null);
});

test("readUploadsBackupStatus: handles partial fields gracefully", () => {
  writeFileSync(
    STATUS_FILE,
    JSON.stringify({
      last_success_at: "2026-08-24T03:00:42Z",
      retention_days: 14,
    }),
  );

  const status = readUploadsBackupStatus();
  assert.notEqual(status, null);
  assert.equal(status!.last_success_at, "2026-08-24T03:00:42Z");
  assert.equal(status!.retention_days, 14);
  assert.equal(status!.last_failure_at, null);
  assert.equal(status!.last_success_size_bytes, null);
  assert.equal(status!.last_success_file_count, null);
});

test("readUploadsBackupStatus: handles failure-only status", () => {
  writeFileSync(
    STATUS_FILE,
    JSON.stringify({
      last_success_at: null,
      last_failure_at: "2026-08-24T03:00:42Z",
      last_failure_reason: "tar_failed",
      last_success_size_bytes: null,
      last_success_sha256: null,
      last_success_file_count: null,
      backup_age_seconds: null,
      restore_test_last_success_at: null,
      restore_test_last_failure_at: null,
      retention_days: 30,
    }),
  );

  const status = readUploadsBackupStatus();
  assert.notEqual(status, null);
  assert.equal(status!.last_success_at, null);
  assert.equal(status!.last_failure_at, "2026-08-24T03:00:42Z");
  assert.equal(status!.last_failure_reason, "tar_failed");
  assert.equal(status!.retention_days, 30);
});

test("readUploadsBackupStatus: rejects non-object JSON (array)", () => {
  writeFileSync(STATUS_FILE, JSON.stringify([1, 2, 3]));
  const status = readUploadsBackupStatus();
  assert.equal(status, null);
});

// ──────────────────────────────────────────────
// computeUploadsBackupAgeSeconds
// ──────────────────────────────────────────────

test("computeUploadsBackupAgeSeconds: returns null for null status", () => {
  const age = computeUploadsBackupAgeSeconds(null);
  assert.equal(age, null);
});

test("computeUploadsBackupAgeSeconds: returns null when last_success_at is null", () => {
  const age = computeUploadsBackupAgeSeconds({
    last_success_at: null,
    last_failure_at: null,
    last_failure_reason: null,
    last_success_size_bytes: null,
    last_success_sha256: null,
    last_success_file_count: null,
    backup_age_seconds: null,
    restore_test_last_success_at: null,
    restore_test_last_failure_at: null,
    retention_days: 30,
  });
  assert.equal(age, null);
});

test("computeUploadsBackupAgeSeconds: returns 0 for just-now timestamp", () => {
  const now = new Date().toISOString();
  const age = computeUploadsBackupAgeSeconds({
    last_success_at: now,
    last_failure_at: null,
    last_failure_reason: null,
    last_success_size_bytes: 1000,
    last_success_sha256: "abc",
    last_success_file_count: 5,
    backup_age_seconds: 0,
    restore_test_last_success_at: null,
    restore_test_last_failure_at: null,
    retention_days: 30,
  });
  assert.ok(age !== null);
  assert.ok(age! < 5, `age should be small, got ${age}`);
});

test("computeUploadsBackupAgeSeconds: returns positive number for past timestamp", () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const age = computeUploadsBackupAgeSeconds({
    last_success_at: oneHourAgo,
    last_failure_at: null,
    last_failure_reason: null,
    last_success_size_bytes: 1000,
    last_success_sha256: "abc",
    last_success_file_count: 5,
    backup_age_seconds: 0,
    restore_test_last_success_at: null,
    restore_test_last_failure_at: null,
    retention_days: 30,
  });
  assert.ok(age !== null);
  assert.ok(age! >= 3500, `age should be ~3600s, got ${age}`);
  assert.ok(age! <= 3700, `age should be ~3600s, got ${age}`);
});

test("computeUploadsBackupAgeSeconds: returns null for unparseable timestamp", () => {
  const age = computeUploadsBackupAgeSeconds({
    last_success_at: "not-a-date",
    last_failure_at: null,
    last_failure_reason: null,
    last_success_size_bytes: 1000,
    last_success_sha256: "abc",
    last_success_file_count: 5,
    backup_age_seconds: 0,
    restore_test_last_success_at: null,
    restore_test_last_failure_at: null,
    retention_days: 30,
  });
  assert.equal(age, null);
});

test("cleanup", () => {
  rmSync(TMP_DIR, { force: true, recursive: true });
});
