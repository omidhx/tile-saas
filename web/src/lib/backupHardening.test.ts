import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

// ──────────────────────────────────────────────
// Phase 8 Hardening Tests
// ──────────────────────────────────────────────
// این تست‌ها رفتارِ امنیاتیِ اسکریپت‌های backup را verify می‌کنند:
//   ۱. status file با permission 0644 ساخته می‌شود
//   ۲. status file atomic write (temp + rename)
//   ۳. backup-status.json با stale preservation کار می‌کند — یعنی
//      اگر status file قبلاً success بوده و حالا fail می‌شود، last_success_at
//      قبلی حفظ می‌شود (نه null).
//   ۴. JSON parse همیشه معتبر است (حتی با عددِ retention_days غیرمعتبر).
//   ۵. restore-db.sh: RESTORE_DB_NAME = POSTGRES_DB رد می‌شود.
//   ۶. restore-db.sh: RESTORE_DB_NAME با کاراکتر غیرمجاز رد می‌شود.
//   ۷. backup-db.sh: BACKUP_RETENTION_DAYS غیرعددی رد می‌شود.
//   ۸. bash syntax check همه‌ی اسکریپت‌ها
//   ۹. trap روی INT/TERM/HUP (نه فقط EXIT)
//   ۱۰. هیچ eval rsync در backup-db.sh نیست
// ──────────────────────────────────────────────

const PROJECT_ROOT = join(__dirname, "..", "..", "..");
const SCRIPTS_DIR = join(PROJECT_ROOT, "scripts");

// Helper: اجرای فرمان bash و گرفتن exit code + stderr
function runBash(scriptPath: string, env: Record<string, string> = {}, args: string[] = []): {
  stdout: string;
  stderr: string;
  exitCode: number | null;
} {
  try {
    const result = execSync(`bash ${scriptPath} ${args.join(" ")}`, {
      env: { ...process.env, ...env },
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: result, stderr: "", exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.status ?? null,
    };
  }
}

// ──────────────────────────────────────────────
// 1. Bash syntax check on all scripts
// ──────────────────────────────────────────────

test("backup-db.sh: bash syntax is valid", () => {
  const result = runBash("-n", {}, [join(SCRIPTS_DIR, "backup-db.sh")]);
  assert.equal(result.exitCode, 0, `Syntax error: ${result.stderr}`);
});

test("restore-db.sh: bash syntax is valid", () => {
  const result = runBash("-n", {}, [join(SCRIPTS_DIR, "restore-db.sh")]);
  assert.equal(result.exitCode, 0, `Syntax error: ${result.stderr}`);
});

test("verify-backup.sh: bash syntax is valid", () => {
  const result = runBash("-n", {}, [join(SCRIPTS_DIR, "verify-backup.sh")]);
  assert.equal(result.exitCode, 0, `Syntax error: ${result.stderr}`);
});

test("cleanup-old-backups.sh: bash syntax is valid", () => {
  const result = runBash("-n", {}, [join(SCRIPTS_DIR, "cleanup-old-backups.sh")]);
  assert.equal(result.exitCode, 0, `Syntax error: ${result.stderr}`);
});

// ──────────────────────────────────────────────
// 2. backup-db.sh: BACKUP_RETENTION_DAYS validation
// ──────────────────────────────────────────────

test("backup-db.sh: rejects non-numeric BACKUP_RETENTION_DAYS", () => {
  const result = runBash(join(SCRIPTS_DIR, "backup-db.sh"), {
    BACKUP_RETENTION_DAYS: "abc",
    BACKUP_GPG_PASSPHRASE: "test-passphrase-32-chars-min-length!!!",
    POSTGRES_PASSWORD: "test",
  });
  assert.notEqual(result.exitCode, 0, "should fail with non-numeric retention");
  assert.ok(result.stderr.includes("BACKUP_RETENTION_DAYS"), "should mention the var name");
  assert.ok(result.stderr.includes("integer"), "should mention integer requirement");
});

test("backup-db.sh: rejects BACKUP_RETENTION_DAYS < 7", () => {
  const result = runBash(join(SCRIPTS_DIR, "backup-db.sh"), {
    BACKUP_RETENTION_DAYS: "3",
    BACKUP_GPG_PASSPHRASE: "test-passphrase-32-chars-min-length!!!",
    POSTGRES_PASSWORD: "test",
  });
  assert.notEqual(result.exitCode, 0, "should fail with retention < 7");
  assert.ok(result.stderr.includes("≥ 7") || result.stderr.includes(">= 7"));
});

// ──────────────────────────────────────────────
// 3. backup-db.sh: required env vars fail-loud
// ──────────────────────────────────────────────

test("backup-db.sh: fails when BACKUP_GPG_PASSPHRASE is missing", () => {
  const result = runBash(join(SCRIPTS_DIR, "backup-db.sh"), {
    POSTGRES_PASSWORD: "test",
    // Deliberately omit BACKUP_GPG_PASSPHRASE
  });
  assert.notEqual(result.exitCode, 0, "should fail without passphrase");
  assert.ok(result.stderr.includes("BACKUP_GPG_PASSPHRASE"));
});

test("backup-db.sh: fails when POSTGRES_PASSWORD is missing", () => {
  const result = runBash(join(SCRIPTS_DIR, "backup-db.sh"), {
    BACKUP_GPG_PASSPHRASE: "test-passphrase-32-chars-min-length!!!",
  });
  assert.notEqual(result.exitCode, 0, "should fail without password");
  assert.ok(result.stderr.includes("POSTGRES_PASSWORD"));
});

// ──────────────────────────────────────────────
// 4. backup-db.sh: SSH key existence check
// ──────────────────────────────────────────────

test("backup-db.sh: rejects non-existent BACKUP_OFFSITE_SSH_KEY", () => {
  const result = runBash(join(SCRIPTS_DIR, "backup-db.sh"), {
    BACKUP_GPG_PASSPHRASE: "test-passphrase-32-chars-min-length!!!",
    POSTGRES_PASSWORD: "test",
    BACKUP_OFFSITE_SSH_KEY: "/nonexistent/key",
  });
  assert.notEqual(result.exitCode, 0, "should fail with non-existent key");
  assert.ok(result.stderr.includes("BACKUP_OFFSITE_SSH_KEY"));
});

// ──────────────────────────────────────────────
// 5. backup-db.sh: rejects invalid BACKUP_OFFSITE_METHOD
// ──────────────────────────────────────────────

test("backup-db.sh: rejects unknown BACKUP_OFFSITE_METHOD", () => {
  const result = runBash(join(SCRIPTS_DIR, "backup-db.sh"), {
    BACKUP_GPG_PASSPHRASE: "test-passphrase-32-chars-min-length!!!",
    POSTGRES_PASSWORD: "test",
    BACKUP_OFFSITE_METHOD: "ftp",
  });
  assert.notEqual(result.exitCode, 0, "should fail with unsupported method");
  assert.ok(result.stderr.includes("BACKUP_OFFSITE_METHOD"));
});

// ──────────────────────────────────────────────
// 6. backup-db.sh: anti-leak defenses
// ──────────────────────────────────────────────

test("backup-db.sh: refuses to run with 'set -x' (passphrase leak risk)", () => {
  // Run with bash -x
  try {
    execSync(`bash -x ${join(SCRIPTS_DIR, "backup-db.sh")}`, {
      env: {
        ...process.env,
        BACKUP_GPG_PASSPHRASE: "secret-test-passphrase",
        POSTGRES_PASSWORD: "test",
      },
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    assert.fail("Should have exited non-zero");
  } catch (e: unknown) {
    const err = e as { stderr?: string; status?: number };
    assert.notEqual(err.status, 0, "should exit non-zero");
    assert.ok(
      err.stderr?.includes("set -x") || err.stderr?.includes("passphrase"),
      `should mention passphrase leak risk: ${err.stderr}`,
    );
  }
});

// ──────────────────────────────────────────────
// 7. restore-db.sh: RESTORE_DB_NAME validation
// ──────────────────────────────────────────────

test("restore-db.sh: rejects RESTORE_DB_NAME = POSTGRES_DB (production safety)", () => {
  const result = runBash(join(SCRIPTS_DIR, "restore-db.sh"), {
    BACKUP_GPG_PASSPHRASE: "test-passphrase-32-chars-min-length!!!",
    POSTGRES_PASSWORD: "test",
    POSTGRES_DB: "tile_saas",
    RESTORE_DB_NAME: "tile_saas", // same as production!
  });
  assert.notEqual(result.exitCode, 0, "must refuse to clobber production DB");
  assert.ok(
    result.stderr.includes("PRODUCTION") || result.stderr.includes("clobber"),
    `should warn about production clobber: ${result.stderr}`,
  );
});

test("restore-db.sh: rejects RESTORE_DB_NAME with invalid characters", () => {
  const result = runBash(join(SCRIPTS_DIR, "restore-db.sh"), {
    BACKUP_GPG_PASSPHRASE: "test-passphrase-32-chars-min-length!!!",
    POSTGRES_PASSWORD: "test",
    RESTORE_DB_NAME: "tile; DROP TABLE app_user; --",
  });
  assert.notEqual(result.exitCode, 0, "must reject SQL injection attempts");
  assert.ok(
    result.stderr.includes("invalid characters") || result.stderr.includes("RESTORE_DB_NAME"),
    `should reject invalid chars: ${result.stderr}`,
  );
});

test("restore-db.sh: accepts valid RESTORE_DB_NAME (tile_restore_test)", () => {
  // This should get past validation (will fail later at docker check, but
  // we only care about the validation step here)
  const result = runBash(join(SCRIPTS_DIR, "restore-db.sh"), {
    BACKUP_GPG_PASSPHRASE: "test-passphrase-32-chars-min-length!!!",
    POSTGRES_PASSWORD: "test",
    RESTORE_DB_NAME: "tile_restore_test",
  });
  // Should fail at docker-compose check (no postgres running), NOT at validation
  assert.notEqual(result.exitCode, 0);
  // Should NOT contain validation error
  assert.ok(
    !result.stderr.includes("PRODUCTION") && !result.stderr.includes("invalid characters"),
    `should pass validation but fail elsewhere: ${result.stderr}`,
  );
});

// ──────────────────────────────────────────────
// 8. backup-db.sh: no eval rsync (security)
// ──────────────────────────────────────────────

test("backup-db.sh: source code does not contain 'eval rsync' command (use array instead)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  // Strip comments (lines starting with #, or trailing # comments)
  const codeLines = src.split("\n").map((line) => {
    // Remove everything after # (but not inside quotes — simple heuristic)
    const hashIdx = line.indexOf("#");
    return hashIdx >= 0 ? line.substring(0, hashIdx) : line;
  });
  const codeOnly = codeLines.join("\n");
  assert.ok(
    !codeOnly.includes("eval rsync"),
    "should not use 'eval rsync' (use array-based invocation instead). Code:\n" + codeOnly,
  );
  assert.ok(
    codeOnly.includes("local_rsync_args[@]") || codeOnly.includes("rsync_args[@]"),
    "should use array-based rsync invocation (e.g. \"${rsync_args[@]}\")",
  );
});

test("backup-db.sh: trap covers EXIT, INT, TERM, HUP (not just EXIT)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  // New pattern: separate traps per signal, with on_signal helper
  assert.ok(/trap\s+cleanup\s+EXIT/.test(src), "trap cleanup EXIT should be set");
  assert.ok(/trap\s+'on_signal 2'\s+INT/.test(src), "trap on_signal 2 INT should be set");
  assert.ok(/trap\s+'on_signal 15'\s+TERM/.test(src), "trap on_signal 15 TERM should be set");
  assert.ok(/trap\s+'on_signal 1'\s+HUP/.test(src), "trap on_signal 1 HUP should be set");
});

test("restore-db.sh: trap covers EXIT, INT, TERM, HUP (not just EXIT)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  assert.ok(/trap\s+maybe_cleanup\s+EXIT/.test(src), "trap maybe_cleanup EXIT should be set");
  assert.ok(/trap\s+'on_signal 2'\s+INT/.test(src), "trap on_signal 2 INT should be set");
  assert.ok(/trap\s+'on_signal 15'\s+TERM/.test(src), "trap on_signal 15 TERM should be set");
  assert.ok(/trap\s+'on_signal 1'\s+HUP/.test(src), "trap on_signal 1 HUP should be set");
});

test("verify-backup.sh: trap covers EXIT, INT, TERM, HUP (not just EXIT)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "verify-backup.sh"), "utf8");
  assert.ok(/trap\s+cleanup\s+EXIT/.test(src), "trap cleanup EXIT should be set");
  assert.ok(/trap\s+'on_signal 2'\s+INT/.test(src), "trap on_signal 2 INT should be set");
  assert.ok(/trap\s+'on_signal 15'\s+TERM/.test(src), "trap on_signal 15 TERM should be set");
  assert.ok(/trap\s+'on_signal 1'\s+HUP/.test(src), "trap on_signal 1 HUP should be set");
});

// ──────────────────────────────────────────────
// 9. backup-db.sh: status file staleness prevention
// ──────────────────────────────────────────────
// This is the critical fix: on failure, status file must preserve
// previous last_success_at (not null it out).

test("backup-db.sh: reads existing status file at startup (stale prevention)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  // The script should read existing status file to preserve last_success_at on failure
  assert.ok(
    src.includes("PREV_LAST_SUCCESS_AT") && src.includes("if [ -f \"${STATUS_FILE}\" ]"),
    "should read previous status file at startup to preserve last_success_at on failure",
  );
});

// ──────────────────────────────────────────────
// 10. backup-db.sh: chmod 0600 on encrypted files
// ──────────────────────────────────────────────

test("backup-db.sh: sets chmod 600 on .gpg file", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  assert.ok(
    src.includes("chmod 600") && src.includes("${BACKUP_FILE_GPG}"),
    "should chmod 600 the encrypted backup file",
  );
});

test("backup-db.sh: sets chmod 600 on .sha256 file", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  assert.ok(
    src.includes("chmod 600") && src.includes("${BACKUP_FILE_GPG}.sha256"),
    "should chmod 600 the checksum file",
  );
});

test("backup-db.sh: sets chmod 0644 on status file (readable by app container)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  assert.ok(
    src.includes("chmod 0644") && src.includes("tmp_status"),
    "should chmod 0644 the status file (readable by app container)",
  );
});

// ──────────────────────────────────────────────
// 11. backup-db.sh: docker compose exec uses -T (non-interactive)
// ──────────────────────────────────────────────

test("backup-db.sh: all docker compose exec calls use -T flag (non-interactive)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  // Filter out comment lines and warn/echo/ok lines (user-facing messages, not commands)
  const lines = src.split("\n").filter((l) => {
    const trimmed = l.trimStart();
    if (trimmed.startsWith("#")) return false;
    if (/^(warn|echo|ok|error|log)\s+/.test(trimmed)) return false;
    return true;
  });
  const execWithoutT = lines.filter(
    (l) => /docker\s+compose.*\bexec\b/.test(l) && !/docker\s+compose.*\bexec\s+-T\b/.test(l),
  );
  // Count total exec calls (must be ≥ 1)
  const execCount = lines.filter((l) => /docker\s+compose.*\bexec\b/.test(l)).length;
  assert.ok(
    execCount >= 1,
    `should have at least one docker compose exec call (found ${execCount})`,
  );
  assert.equal(
    execWithoutT.length,
    0,
    `all docker compose exec calls on a single line must use -T. Offending:\n${execWithoutT.join("\n")}`,
  );
});

test("restore-db.sh: all docker compose exec calls use -T flag (non-interactive)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  // Strip lines that are clearly inside a string (warn "..." or echo "...") to avoid false positives
  const lines = src.split("\n").filter((l) => {
    const trimmed = l.trimStart();
    // Skip warn/echo/ok lines (these are user-facing messages, not actual commands)
    if (/^(warn|echo|ok|error|log)\s+/.test(trimmed)) return false;
    return true;
  });
  const execWithoutT = lines.filter(
    (l) => /docker\s+compose.*\bexec\b/.test(l) && !/docker\s+compose.*\bexec\s+-T\b/.test(l),
  );
  assert.equal(
    execWithoutT.length,
    0,
    `all docker compose exec calls on a single line must use -T. Offending:\n${execWithoutT.join("\n")}`,
  );
});

// ──────────────────────────────────────────────
// 12. backup-db.sh: atomic status file write (temp + rename)
// ──────────────────────────────────────────────

test("backup-db.sh: status file write is atomic (temp + mv)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  assert.ok(
    src.includes("mktemp") && src.includes("mv -f") && src.includes("tmp_status"),
    "should write status file atomically (temp file + mv)",
  );
});

test("restore-db.sh: status file write is atomic (temp + mv)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  assert.ok(
    src.includes("mktemp") && src.includes("mv -f") && src.includes("TMP_STATUS"),
    "should write status file atomically (temp file + mv)",
  );
});

// ──────────────────────────────────────────────
// 13. backup-db.sh: passphrase never in args
// ──────────────────────────────────────────────

test("backup-db.sh: passphrase is passed via stdin (--passphrase-fd 0), never as an arg", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  // Look for --passphrase-fd 0 (good) and absence of --passphrase <value> (bad)
  assert.ok(
    src.includes("--passphrase-fd 0"),
    "should use --passphrase-fd 0 (stdin) for passphrase",
  );
  assert.ok(
    !/--passphrase\s+["']?\$/.test(src),
    "should NOT pass passphrase as a command-line argument",
  );
});

test("verify-backup.sh: passphrase is passed via stdin, never as an arg", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "verify-backup.sh"), "utf8");
  assert.ok(src.includes("--passphrase-fd 0"));
  assert.ok(!/--passphrase\s+["']?\$/.test(src));
});

test("restore-db.sh: passphrase is passed via stdin, never as an arg", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  assert.ok(src.includes("--passphrase-fd 0"));
  assert.ok(!/--passphrase\s+["']?\$/.test(src));
});

// ──────────────────────────────────────────────
// 14. backup-db.sh: anti-leak — set +o history
// ──────────────────────────────────────────────

test("backup-db.sh: disables shell history during execution", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  assert.ok(
    src.includes("set +o history"),
    "should disable shell history to prevent passphrase leak",
  );
});

test("restore-db.sh: disables shell history during execution", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  assert.ok(src.includes("set +o history"));
});

test("verify-backup.sh: disables shell history during execution", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "verify-backup.sh"), "utf8");
  assert.ok(src.includes("set +o history"));
});

// ──────────────────────────────────────────────
// 15. backup-db.sh: gpg stderr is captured, not printed directly
// ──────────────────────────────────────────────

test("backup-db.sh: gpg stderr goes to a temp log file, not directly to console", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  // The gpg encrypt call should redirect stderr to a file in TMP_DIR
  assert.ok(
    src.includes("2>\"${TMP_DIR}/gpg_encrypt.log\"") || src.includes("2>\"${TMP_DIR}/gpg.log\""),
    "gpg stderr should go to a temp log file",
  );
  // Should NOT have `2>&1` for gpg calls (which would mix stderr into stdout)
  assert.ok(
    !/gpg[^\n]*2>&1/.test(src),
    "gpg calls should not use 2>&1 (stderr should go to log file)",
  );
});

// ──────────────────────────────────────────────
// 16. verify-backup.sh: uses docker compose ps (not docker ps | grep postgres)
// ──────────────────────────────────────────────

test("verify-backup.sh: uses 'docker compose ps postgres' (not 'docker ps | grep postgres')", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "verify-backup.sh"), "utf8");
  // Should use docker compose ps, not the bare docker ps | grep pattern
  assert.ok(
    src.includes("docker compose -f") && src.includes("ps postgres"),
    "should use 'docker compose ps postgres' (respects COMPOSE_FILE env var)",
  );
  assert.ok(
    !/docker\s+ps\s+--format.*grep\s+["']postgres["']/.test(src),
    "should not use 'docker ps | grep postgres' (matches wrong containers)",
  );
});

// ──────────────────────────────────────────────
// 17. verify-backup.sh: uses array for pg_restore_cmd (not string)
// ──────────────────────────────────────────────

test("verify-backup.sh: pg_restore_cmd is an array (no word-splitting bug)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "verify-backup.sh"), "utf8");
  assert.ok(
    src.includes("pg_restore_cmd=(") || src.includes("pg_restore_cmd+=("),
    "should use array for pg_restore_cmd",
  );
  assert.ok(
    src.includes("\"${pg_restore_cmd[@]}\""),
    "should invoke as \"${pg_restore_cmd[@]}\"",
  );
});

// ──────────────────────────────────────────────
// 18. restore-db.sh: maybe_cleanup is defined BEFORE trap
// ──────────────────────────────────────────────

test("restore-db.sh: maybe_cleanup function is defined before the trap that references it", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  const cleanupDefIndex = src.indexOf("maybe_cleanup()");
  const trapIndex = src.indexOf("trap maybe_cleanup EXIT");
  assert.ok(cleanupDefIndex > -1, "maybe_cleanup should be defined");
  assert.ok(trapIndex > -1, "trap maybe_cleanup EXIT should be set");
  assert.ok(
    cleanupDefIndex < trapIndex,
    "maybe_cleanup must be defined BEFORE trap (order matters if script exits early)",
  );
});

// ──────────────────────────────────────────────
// 19. Concurrency guards (flock) — prevents two simultaneous runs
// ──────────────────────────────────────────────

test("backup-db.sh: uses flock for concurrency guard (prevents two simultaneous runs)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  assert.ok(
    src.includes("flock -n 200"),
    "should use flock -n 200 (non-blocking lock on FD 200)",
  );
  assert.ok(
    src.includes("exec 200>"),
    "should allocate FD 200 for the lock file",
  );
  assert.ok(
    src.includes("already running"),
    "should report 'already running' when lock fails",
  );
});

test("restore-db.sh: uses flock for concurrency guard", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  assert.ok(src.includes("flock -n 200"), "should use flock -n 200");
  assert.ok(src.includes("exec 200>"), "should allocate FD 200");
});

test("cleanup-old-backups.sh: uses flock for concurrency guard", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "cleanup-old-backups.sh"), "utf8");
  assert.ok(src.includes("flock -n 200"), "should use flock -n 200");
  assert.ok(src.includes("exec 200>"), "should allocate FD 200");
});

test("ci-backup-test.sh: uses flock for concurrency guard", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  assert.ok(src.includes("flock -n 200"), "should use flock -n 200");
  assert.ok(src.includes("exec 200>"), "should allocate FD 200");
});

// ──────────────────────────────────────────────
// 20. pipefail is set in all scripts (catches pipe failures)
// ──────────────────────────────────────────────

test("all backup scripts: have 'set -euo pipefail' (catches pipe failures)", () => {
  const scripts = [
    "backup-db.sh",
    "restore-db.sh",
    "verify-backup.sh",
    "cleanup-old-backups.sh",
    "ci-backup-test.sh",
  ];
  for (const s of scripts) {
    const src = readFileSync(join(SCRIPTS_DIR, s), "utf8");
    assert.ok(
      src.includes("set -euo pipefail"),
      `${s} should have 'set -euo pipefail' (without pipefail, a pg_dump failure in a pipe could go undetected)`,
    );
  }
});

// ──────────────────────────────────────────────
// 21. ci-backup-test.sh: bash syntax is valid
// ──────────────────────────────────────────────

test("ci-backup-test.sh: bash syntax is valid", () => {
  const result = runBash("-n", {}, [join(SCRIPTS_DIR, "ci-backup-test.sh")]);
  assert.equal(result.exitCode, 0, `Syntax error: ${result.stderr}`);
});

test("ci-backup-test.sh: validates RESTORE_DB_NAME against POSTGRES_DB equality", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  assert.ok(
    src.includes("RESTORE_DB_NAME") && src.includes("POSTGRES_DB") &&
    src.includes("must not equal POSTGRES_DB"),
    "should refuse to run if RESTORE_DB_NAME equals POSTGRES_DB",
  );
});

test("ci-backup-test.sh: validates RESTORE_DB_NAME against regex", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  assert.ok(
    src.includes("^[a-zA-Z_][a-zA-Z0-9_]*$") || src.includes("[a-zA-Z_][a-zA-Z0-9_]*"),
    "should validate RESTORE_DB_NAME against a safe identifier regex",
  );
});

test("ci-backup-test.sh: drops the temporary database on cleanup", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  assert.ok(
    src.includes("DROP DATABASE IF EXISTS") && src.includes("RESTORE_DB_NAME"),
    "should DROP DATABASE IF EXISTS in cleanup function",
  );
  assert.ok(
    /cleanup\(\)/.test(src),
    "should have a cleanup function",
  );
});

// ──────────────────────────────────────────────
// 22. restore-db.sh: transactional integrity test (BEGIN/INSERT/ROLLBACK)
// ──────────────────────────────────────────────

test("restore-db.sh: includes transactional integrity test (BEGIN/INSERT/ROLLBACK)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  assert.ok(
    src.includes("BEGIN;") && src.includes("ROLLBACK;"),
    "should have a transactional integrity test with BEGIN/INSERT/ROLLBACK",
  );
  assert.ok(
    src.includes("restore_test_validation"),
    "should insert a row with a recognizable action label",
  );
  assert.ok(
    src.includes("Transactional integrity"),
    "should log 'Transactional integrity' test result",
  );
});

test("ci-backup-test.sh: includes transactional integrity test", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  assert.ok(
    src.includes("BEGIN;") && src.includes("ROLLBACK;"),
    "should have a transactional integrity test with BEGIN/INSERT/ROLLBACK",
  );
  assert.ok(
    src.includes("restore_test_validation"),
    "should insert a row with a recognizable action label",
  );
});

// ──────────────────────────────────────────────
// 23. ci-backup-test.sh: atomic status file write (same as backup-db.sh)
// ──────────────────────────────────────────────

test("ci-backup-test.sh: status file write is atomic (temp + mv + chmod 0644)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  assert.ok(src.includes("mktemp"), "should use mktemp for temp status file");
  assert.ok(src.includes("mv -f"), "should use mv -f for atomic rename");
  assert.ok(src.includes("chmod 0644"), "should chmod 0644 the status file");
});

// ──────────────────────────────────────────────
// 24. CI workflow: invokes scripts/ci-backup-test.sh (not inline logic)
// ──────────────────────────────────────────────

test("CI workflow invokes scripts/ci-backup-test.sh (drift prevention)", () => {
  const ciYaml = readFileSync(join(PROJECT_ROOT, ".github", "workflows", "ci.yml"), "utf8");
  assert.ok(
    ciYaml.includes("bash scripts/ci-backup-test.sh"),
    "CI should invoke scripts/ci-backup-test.sh (not inline logic — prevents drift)",
  );
  // The old inline logic should NOT be present anymore
  assert.ok(
    !ciYaml.includes("Step 1: pg_dump directly"),
    "CI should no longer contain inline pg_dump logic (use scripts/ci-backup-test.sh instead)",
  );
});

// ──────────────────────────────────────────────
// 25. CLEANUP_DONE guard — prevents double-cleanup on EXIT+signal
// ──────────────────────────────────────────────
// این الگو بحرانی است: وقتی Ctrl+C می‌زنیم، INT handler اجرا می‌شود
// و exit 130 صدا زده می‌شود. سپس EXIT trap اجرا می‌شود (به‌خاطرِ exit).
// بدون CLEANUP_DONE guard، cleanup دوبار اجرا می‌شد: DROP DATABASE دوبار،
// logهای گمراه‌کننده، و در شرایط rare، race condition.

test("backup-db.sh: has CLEANUP_DONE guard to prevent double-cleanup", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  assert.ok(
    src.includes("CLEANUP_DONE=0") &&
    src.includes('if [ "${CLEANUP_DONE}" -eq 1 ]') &&
    src.includes("CLEANUP_DONE=1"),
    "should define CLEANUP_DONE guard pattern (init + check + set)",
  );
});

test("restore-db.sh: has CLEANUP_DONE guard to prevent double-cleanup", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  assert.ok(
    src.includes("CLEANUP_DONE=0") &&
    src.includes('if [ "${CLEANUP_DONE}" -eq 1 ]'),
    "should define CLEANUP_DONE guard",
  );
});

test("verify-backup.sh: has CLEANUP_DONE guard to prevent double-cleanup", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "verify-backup.sh"), "utf8");
  assert.ok(
    src.includes("CLEANUP_DONE=0") &&
    src.includes('if [ "${CLEANUP_DONE}" -eq 1 ]'),
    "should define CLEANUP_DONE guard",
  );
});

test("ci-backup-test.sh: has CLEANUP_DONE guard to prevent double-cleanup", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  assert.ok(
    src.includes("CLEANUP_DONE=0") &&
    src.includes('if [ "${CLEANUP_DONE}" -eq 1 ]'),
    "should define CLEANUP_DONE guard",
  );
});

// ──────────────────────────────────────────────
// 26. on_signal function uses 128 + signal_number (conventional exit codes)
// ──────────────────────────────────────────────
// INT → 130, TERM → 143, HUP → 129 (per POSIX: 128 + signal number)

test("backup-db.sh: on_signal exits with 128 + signal_number (conventional)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  assert.ok(
    /on_signal\(\)/.test(src) &&
    /exit \$\(\(128 \+ sig\)\)/.test(src),
    "should have on_signal function that exits with 128 + signal_number",
  );
  assert.ok(
    /trap\s+'on_signal 2'\s+INT/.test(src) &&
    /trap\s+'on_signal 15'\s+TERM/.test(src) &&
    /trap\s+'on_signal 1'\s+HUP/.test(src),
    "should trap INT/TERM/HUP with correct signal numbers",
  );
});

test("restore-db.sh: on_signal exits with 128 + signal_number", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  assert.ok(
    /on_signal\(\)/.test(src) &&
    /exit \$\(\(128 \+ sig\)\)/.test(src),
    "should have on_signal function with 128 + signal_number pattern",
  );
});

test("verify-backup.sh: on_signal exits with 128 + signal_number", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "verify-backup.sh"), "utf8");
  assert.ok(
    /on_signal\(\)/.test(src) &&
    /exit \$\(\(128 \+ sig\)\)/.test(src),
    "should have on_signal function with 128 + signal_number pattern",
  );
});

test("ci-backup-test.sh: on_signal exits with 128 + signal_number", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  assert.ok(
    /on_signal\(\)/.test(src) &&
    /exit \$\(\(128 \+ sig\)\)/.test(src),
    "should have on_signal function with 128 + signal_number pattern",
  );
});

// ──────────────────────────────────────────────
// 27. cleanup does NOT call exit (only signal handler does)
// ──────────────────────────────────────────────
// اگر cleanup خودش exit صدا بزند، EXIT trap دوباره اجرا می‌شود و loop پیش می‌آید.
// الگوی صحیح: cleanup فقط کارش را انجام دهد و return کند. EXIT trap خودش
// اسکریپت را exit می‌کند (به‌صورت ضمنی با اجرای آخرین دستور).

test("backup-db.sh: cleanup() does not call exit (signal handler does)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  // Find cleanup() function body and verify it doesn't have `exit`
  const cleanupMatch = src.match(/cleanup\(\)\s*{[\s\S]*?^}/m);
  assert.ok(cleanupMatch, "cleanup function should be defined");
  const cleanupBody = cleanupMatch![0];
  // Allow only comments containing 'exit' (like "exit code")
  // Strip comments first
  const noComments = cleanupBody.split("\n")
    .map(l => l.replace(/#.*$/, ""))
    .join("\n");
  assert.ok(
    !/\bexit\b\s+\$/.test(noComments) && !/\bexit\b\s+\d/.test(noComments),
    `cleanup() must not call exit() (signal handler does that). Cleanup body:\n${cleanupBody}`,
  );
});

test("ci-backup-test.sh: cleanup() does not call exit (signal handler does)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  const cleanupMatch = src.match(/cleanup\(\)\s*{[\s\S]*?^}/m);
  assert.ok(cleanupMatch, "cleanup function should be defined");
  const cleanupBody = cleanupMatch![0];
  const noComments = cleanupBody.split("\n")
    .map(l => l.replace(/#.*$/, ""))
    .join("\n");
  assert.ok(
    !/\bexit\b\s+\$/.test(noComments) && !/\bexit\b\s+\d/.test(noComments),
    "cleanup() must not call exit()",
  );
});

// ──────────────────────────────────────────────
// 28. DROP DATABASE is preceded by pg_terminate_backend (no stale connections)
// ──────────────────────────────────────────────

test("restore-db.sh: drops temporary database with pg_terminate_backend first", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  // The cleanup function should call pg_terminate_backend before DROP DATABASE
  assert.ok(
    src.includes("pg_terminate_backend(pid)") &&
    src.includes("datname = '${RESTORE_DB_NAME}'") &&
    src.includes("DROP DATABASE IF EXISTS"),
    "should call pg_terminate_backend before DROP DATABASE to clear connections",
  );
});

test("ci-backup-test.sh: drops temporary database with pg_terminate_backend first", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  assert.ok(
    src.includes("pg_terminate_backend(pid)") &&
    src.includes("datname = '${RESTORE_DB_NAME}'") &&
    src.includes("DROP DATABASE IF EXISTS"),
    "should call pg_terminate_backend before DROP DATABASE",
  );
});

// ──────────────────────────────────────────────
// 29. ci-backup-test.sh: requires flock in the pre-flight command check
// ──────────────────────────────────────────────

test("ci-backup-test.sh: requires flock in pre-flight command check", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  assert.ok(
    src.includes("flock") &&
    /for cmd in.*flock/.test(src.replace(/\s+/g, " ")),
    "should require flock in the pre-flight command check loop",
  );
});

// ──────────────────────────────────────────────
// 30. Row counts for key tables (catches partial restore)
// ──────────────────────────────────────────────

test("restore-db.sh: includes row count checks for key tables", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  assert.ok(
    src.includes("audit_log") && src.includes("product") &&
    src.includes("inventory_balance") && src.includes("reservation"),
    "should check row counts for audit_log, product, inventory_balance, reservation",
  );
});

test("ci-backup-test.sh: includes row count checks for key tables", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "ci-backup-test.sh"), "utf8");
  assert.ok(
    src.includes("audit_log") && src.includes("product") &&
    src.includes("inventory_balance") && src.includes("reservation"),
    "should check row counts for key tables",
  );
});

// ──────────────────────────────────────────────
// 31. No `trap - EXIT` (trap reset) in success path
// ──────────────────────────────────────────────
// اگر اسکریپت در مسیرِ موفقیت `trap - EXIT` بزند، cleanup در EXIT اجرا
// نمی‌شود و فایل‌های موقت باقی می‌مانند. CLEANUP_DONE guard این نیاز را
// از بین می‌برد.

test("backup-db.sh: does NOT reset traps in success path (relies on CLEANUP_DONE guard)", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "backup-db.sh"), "utf8");
  assert.ok(
    !src.includes("trap - EXIT"),
    "should not reset traps (CLEANUP_DONE guard makes this unnecessary)",
  );
});

test("restore-db.sh: does NOT reset traps in success path", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "restore-db.sh"), "utf8");
  assert.ok(
    !src.includes("trap - EXIT"),
    "should not reset traps (CLEANUP_DONE guard makes this unnecessary)",
  );
});

test("verify-backup.sh: does NOT reset traps in success path", () => {
  const src = readFileSync(join(SCRIPTS_DIR, "verify-backup.sh"), "utf8");
  assert.ok(
    !src.includes("trap - EXIT"),
    "should not reset traps (CLEANUP_DONE guard makes this unnecessary)",
  );
});
