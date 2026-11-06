import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, resetSchema } from "@/db/_testdb";
import { T, seedTenant } from "@/db/_fixtures";

/**
 * فاز ۴: `cleanup:uploads --commit` با نقشِ app_user زیرِ RLS هیچ ارجاعی نمی‌دید و عکس‌های
 * زنده را یتیم حساب می‌کرد. خودِ اسکریپت اجرا می‌شود، در پوشه‌ی موقت (نه پوشه‌ی آپلودِ واقعی).
 */
const SCRIPT = fileURLToPath(new URL("../../scripts/cleanup-orphan-uploads.ts", import.meta.url));
// cwdِ اسکریپت پوشه‌ی موقت است، پس --import tsx باید مسیرِ مطلق باشد
const TSX = new URL("../../node_modules/tsx/dist/loader.mjs", import.meta.url).href;

function run(env: Record<string, string>, cwd: string) {
  const { DATABASE_URL: _a, MIGRATION_DATABASE_URL: _b, ...rest } = process.env;
  return spawnSync(process.execPath, ["--import", TSX, SCRIPT, "--commit"], {
    cwd, encoding: "utf8", env: { ...rest, ...env },
  });
}

function uploadsDir() {
  const cwd = mkdtempSync(join(tmpdir(), "cleanup-test-"));
  const dir = join(cwd, "private", "uploads");
  mkdirSync(dir, { recursive: true });
  const old = new Date(Date.now() - 30 * 86_400_000);
  for (const f of ["live.png", "logo.png", "orphan.png", "fresh.png"]) {
    writeFileSync(join(dir, f), "x");
    if (f !== "fresh.png") utimesSync(join(dir, f), old, old);
  }
  return { cwd, has: (f: string) => existsSync(join(dir, f)) };
}

before(async () => {
  await resetSchema();
  await seedTenant();
  await sql.unsafe(`
    UPDATE tenant SET logo_url = '/uploads/logo.png' WHERE id = '${T}';
    INSERT INTO product (id,tenant_id,code,name,image_url)
      VALUES ('e1111111-1111-1111-1111-111111111111','${T}','P1','کاشی','/uploads/live.png');
    INSERT INTO product_image (tenant_id,product_id,url)
      VALUES ('${T}','e1111111-1111-1111-1111-111111111111','/uploads/live.png');
  `);
});

test("فاز ۴: cleanup:uploads --commit با نقشِ app_user هیچ فایلی را پاک نمی‌کند", () => {
  const d = uploadsDir();
  const r = run({ DATABASE_URL: process.env.DATABASE_URL! }, d.cwd);
  assert.ok(d.has("live.png") && d.has("logo.png"), `عکسِ زنده پاک شد:\n${r.stdout}${r.stderr}`);
  assert.ok(d.has("orphan.png"), "بدون دیدنِ همه‌ی tenantها حتی یتیم هم نباید پاک شود");
  assert.notEqual(r.status, 0, "باید با خطا خارج شود تا اپراتور بفهمد");
});

test("فاز ۴: cleanup:uploads --commit با نقشِ مالک فقط یتیمِ قدیمی را پاک می‌کند", () => {
  const d = uploadsDir();
  const r = run({ MIGRATION_DATABASE_URL: process.env.TEST_ADMIN_DATABASE_URL! }, d.cwd);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(d.has("live.png") && d.has("logo.png"), "عکسِ زنده پاک شد");
  assert.ok(d.has("fresh.png"), "فایلِ تازه ممکن است وسطِ آپلود باشد");
  assert.ok(!d.has("orphan.png"), r.stdout);
});
