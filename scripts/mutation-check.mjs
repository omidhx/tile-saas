#!/usr/bin/env node
// باگ عمدی می‌کارد و باید تست مربوط قرمز شود. سبز ماندن یعنی آن قانون هیچ محافظی ندارد.
// فهرست از ممیزی E5 آمده؛ هر متن old باید دقیقاً پیدا شود تا refactor بی‌صدا چک را بی‌اثر نکند.
// expect همان تستی است که باید این باگ را بگیرد؛ قرمزشدن به هر دلیل دیگری (مثلاً قطع DB) caught نیست.
//
//   node scripts/mutation-check.mjs [m2 m8 ...]
//
// نیازها مثل تست‌ها: DATABASE_URL، TEST_ADMIN_DATABASE_URL؛ برای bhS ابزارهای backup (psql، gpg، zstd، flock).
// روی کپی موقت کار می‌کند، پس قطع‌شدن وسط کار درخت اصلی را خراب نمی‌کند.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RESERVE = "web/src/db/reservations.ts";
const RESERVE_SUITE = [
  "src/db/stockContention.test.ts", "src/db/reserve.test.ts", "src/db/concurrencyIdempotency.test.ts",
  "src/db/holdExpiry.test.ts", "src/db/autoApprove.test.ts",
];
const LOCK = "      ORDER BY lot_id\n      FOR UPDATE`;";
const BACKUP_TEST = ["bash", "scripts/ci-backup-script-test.sh"];

const MUTATIONS = [
  // ۱۰ موردی که در ممیزی از تست‌ها رد شدند
  { id: "m2", expect: "رقابت روی یک lot", why: "قفل ردیف موجودی حذف شد", file: RESERVE, edits: [[LOCK, "      ORDER BY lot_id`;"]], tests: RESERVE_SUITE },
  { id: "m2p", expect: "رقابت روی یک lot", why: "قفل حذف و پنجره‌ی race با pg_sleep باز شد", file: RESERVE,
    edits: [[LOCK, "      ORDER BY lot_id`;\n    await tx`SELECT pg_sleep(0.05)`;"]], tests: RESERVE_SUITE },
  { id: "m4", expect: "proxy CSRF: POST بین‌مبدأ", why: "چک بین‌مبدأ در proxy حذف شد", file: "web/src/proxy.ts",
    edits: [["if (url.host !== host) {", "if (false) {"]], tests: ["src/auth/csrf.test.ts"] },
  { id: "m4b", expect: "assertSameOrigin: POST بین‌مبدأ", why: "چک بین‌مبدأ در assertSameOrigin حذف شد", file: "web/src/auth/csrf.ts",
    edits: [["if (url.host !== host) {", "if (false) {"]], tests: ["src/auth/csrf.test.ts"] },
  { id: "m5", expect: "listCustomers با RLS خاموش", why: "فیلتر tenant در فهرست مشتری حذف شد", file: "web/src/db/customers.ts",
    edits: [["WHERE c.tenant_id = ${p.tenantId}", "WHERE TRUE"]], tests: ["src/db/customers.test.ts", "src/db/crossTenantIsolation.test.ts"] },
  { id: "m6b", expect: "authorizeAdmin: staff کافی نیست", why: "چک نقش admin حذف شد", file: "web/src/auth/authz.ts",
    edits: [['if (m.role !== "admin") throw new AuthzError("این عملیات نیازمند نقشِ admin است");', ""]], tests: ["src/auth/authz.test.ts"] },
  { id: "m8", expect: "view: رزرو منقضی", why: "view رزرو منقضی را هم held حساب می‌کند", file: "db/schema.sql",
    edits: [["AND r.expires_at > now()", "AND TRUE"]], tests: ["src/db/holdExpiry.test.ts"] },
  { id: "m10", expect: "RLS: بدون app.tenant_id", why: "RLS روی همه‌ی جدول‌ها خاموش شد", file: "db/schema.sql",
    edits: [["ALTER TABLE %I ENABLE ROW LEVEL SECURITY", "ALTER TABLE %I DISABLE ROW LEVEL SECURITY"],
            ["ALTER TABLE %I FORCE ROW LEVEL SECURITY", "ALTER TABLE %I NO FORCE ROW LEVEL SECURITY"]],
    tests: ["src/db/appRole.test.ts"] },
  { id: "m14", expect: "موجودی آزادشده از رزرو منقضی", why: "held در مسیر رزرو رزرو منقضی را هم می‌شمارد", file: RESERVE,
    edits: [["WHERE ri.lot_id = ${b.lot_id} AND r.status = 'active' AND r.expires_at > now()", "WHERE ri.lot_id = ${b.lot_id} AND r.status = 'active'"]],
    tests: RESERVE_SUITE },
  { id: "bhS", expect: "بکاپ باید 600 باشد", why: "فایل بکاپ world-readable شد", file: "scripts/backup-db.sh",
    edits: [['chmod 600 "${BACKUP_FILE_GPG}"\n', 'chmod 644 "${BACKUP_FILE_GPG}"\n']], command: BACKUP_TEST },
  // بخش دوم همان ردیف ممیزی (bhS)، جدا تا هر کدام مستقل گرفته شود
  { id: "bhS2", expect: "Step 3/6", why: "fd اشتباه passphrase در gpg", file: "scripts/backup-db.sh",
    edits: [["--passphrase-fd 0 \\\n  --symmetric", "--passphrase-fd 7 \\\n  --symmetric"]], command: BACKUP_TEST },
  // ۶ موردی که ممیزی گرفته بود؛ برای اینکه محافظشان بی‌صدا از بین نرود
  { id: "m1", expect: "۴۰۹: available کمتر از requested", why: "چک available حذف شد", file: RESERVE,
    edits: [["if (available < requested)", "if (false && available < requested)"]], tests: RESERVE_SUITE },
  { id: "m3", expect: "loaded: on_hand و allocated", why: "loaded موجودی را کم نمی‌کند", file: "web/src/db/dispatches.ts",
    edits: [["SET on_hand_qty_boxes = on_hand_qty_boxes - ${it.quantity_boxes},", "SET on_hand_qty_boxes = on_hand_qty_boxes,"]],
    tests: ["src/db/dispatches.test.ts", "src/db/ledger.test.ts"] },
  { id: "m3b", expect: "لجرِ کاملاً تراز", why: "لجر dispatch_load مقدار صفر می‌نویسد", file: "web/src/db/dispatches.ts",
    edits: [["'dispatch_load', ${-it.quantity_boxes}, ${-it.quantity_boxes},", "'dispatch_load', 0, ${-it.quantity_boxes},"]],
    tests: ["src/db/ledger.test.ts"] },
  { id: "m6a", expect: "authorizeStaff: نماینده", why: "چک نقش staff حذف شد", file: "web/src/auth/authz.ts",
    edits: [['if (m.role !== "staff" && m.role !== "admin") throw new AuthzError("این عملیات نیازمند نقشِ staff است");\n    tagRequest(userId, tenantId);\n    return { userId, tenantId, role: m.role };\n  });\n}\n\n/**\n * دسترسیِ admin', 'tagRequest(userId, tenantId);\n    return { userId, tenantId, role: m.role };\n  });\n}\n\n/**\n * دسترسیِ admin']],
    tests: ["src/auth/authz.test.ts"] },
  { id: "m7", expect: "تغییر رمز همه‌ی نشست‌ها", why: "تغییر رمز sessionها را باطل نمی‌کند", file: "web/src/auth/passwordFlows.ts",
    edits: [["await tx`UPDATE app_user SET password_hash = ${hash} WHERE id = ${p.userId}`;\n    await invalidateSessionsIn(tx, p.userId);", "await tx`UPDATE app_user SET password_hash = ${hash} WHERE id = ${p.userId}`;"]],
    tests: ["src/auth/passwordFlows.test.ts"] },
  { id: "bh12", expect: "rejects RESTORE_DB_NAME", why: "گارد RESTORE_DB_NAME == POSTGRES_DB حذف شد", file: "scripts/restore-db.sh",
    edits: [['if [ "${RESTORE_DB_NAME}" = "${POSTGRES_DB}" ]; then', "if false; then"]], tests: ["src/lib/backupHardening.test.ts"] },
];

const repo = resolve(fileURLToPath(import.meta.url), "../..");
const only = process.argv.slice(2);
const selected = only.length ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;

const work = mkdtempSync(join(tmpdir(), "tile-mutation-"));
const SKIP = new Set([".git", "node_modules", ".next", ".claude", "_backups", "_audit", "test-results"]);
cpSync(repo, work, { recursive: true, filter: (src) => !SKIP.has(basename(src)) });
symlinkSync(join(repo, "web/node_modules"), join(work, "web/node_modules"), "junction");

function run(mutation) {
  const [cmd, args, cwd] = mutation.command
    ? [mutation.command[0], mutation.command.slice(1), work]
    : [process.execPath, ["--env-file=.env.test", "--import", "tsx", "--test", "--test-concurrency=1", "--test-reporter=tap", ...mutation.tests], join(work, "web")];
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: 600_000, maxBuffer: 256 * 1024 * 1024, env: process.env });
  const output = (r.stdout ?? "") + (r.stderr ?? "");
  const failed = output.split("\n").filter((l) => /^not ok /.test(l) && !/# TODO/.test(l)).map((l) => l.replace(/^not ok \d+ - /, ""));
  return { green: r.status === 0, failed, output };
}

// بدون baseline سبز، قرمزشدن بعد از mutation هیچ چیزی را ثابت نمی‌کند.
const seen = new Set();
for (const m of selected) {
  const key = JSON.stringify(m.tests ?? m.command);
  if (seen.has(key)) continue;
  seen.add(key);
  const base = run(m);
  if (!base.green) {
    console.error(`ABORT: baseline قرمز است برای ${key}\n${base.output.slice(-4000)}`);
    process.exit(2);
  }
}
console.log(`baseline سبز (${seen.size} مجموعه)\n`);

let missed = 0;
for (const m of selected) {
  const path = join(work, m.file);
  const original = readFileSync(path, "utf8");
  let mutated = original;
  for (const [from, to] of m.edits) {
    if (!mutated.includes(from)) {
      console.error(`ABORT: ${m.id}: متن مورد انتظار در ${m.file} پیدا نشد؛ فهرست mutationها کهنه است:\n${from}`);
      process.exit(2);
    }
    mutated = mutated.replaceAll(from, to);
  }
  writeFileSync(path, mutated);
  const result = run(m);
  writeFileSync(path, original);
  const by = result.failed.length ? result.failed.join(" | ") : result.output;
  if (result.green || !by.includes(m.expect)) {
    missed++;
    console.log(`MISSED ${m.id}: ${m.why}\n       انتظار: ${m.expect}\n       دیده شد: ${result.green ? "همه سبز" : by.slice(-600)}`);
  } else {
    const shown = result.failed.length ? by : by.trim().split("\n").filter((l) => !l.startsWith("NOTICE")).slice(-2).join(" / ");
    console.log(`CAUGHT ${m.id}: ${m.why}\n       by: ${shown}`);
  }
}

rmSync(work, { recursive: true, force: true });
console.log(`\n${selected.length - missed}/${selected.length} caught`);
process.exit(missed ? 1 : 0);
