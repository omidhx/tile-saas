import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { sql, resetSchema } from "./_testdb";

// خودِ scripts/migrate.ts را با همان دستوری اجرا می‌کند که npm run migrate و compose اجرا می‌کنند.
function migrate(url: string) {
  return spawnSync(process.execPath, ["--import", "tsx", "scripts/migrate.ts"], {
    encoding: "utf8",
    env: { ...process.env, MIGRATION_DATABASE_URL: url, APP_USER_PASSWORD: new URL(process.env.DATABASE_URL!).password },
  });
}
const ADMIN = process.env.TEST_ADMIN_DATABASE_URL!;

before(async () => {
  await resetSchema();
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
});

test("migrate: روی دیتابیس خالی همه‌چیز را می‌سازد و هر migration را ثبت می‌کند", async () => {
  const r = migrate(ADMIN);
  assert.equal(r.status, 0, r.stderr);
  const [row] = await sql<{ tenant: string | null; migrations: number; invoker: string[] | null }[]>`
    SELECT to_regclass('public.tenant')::text AS tenant,
           (SELECT count(*)::int FROM _migrations) AS migrations,
           (SELECT reloptions FROM pg_class WHERE relname = 'v_lot_availability') AS invoker`;
  assert.equal(row.tenant, "tenant");
  assert.ok(row.migrations >= 6, `فقط ${row.migrations} migration ثبت شد`);
  assert.deepEqual(row.invoker, ["security_invoker=true"]);
});

test("migrate: نقش app_user واقعاً grant گرفته و RLS خورده است", async () => {
  const [row] = await sql<{ super: boolean; bypass: boolean; dml: boolean; exec: boolean; pub: boolean }[]>`
    SELECT r.rolsuper AS super, r.rolbypassrls AS bypass,
           has_table_privilege('app_user', 'product', 'INSERT') AS dml,
           has_function_privilege('app_user', 'expire_due_reservations()', 'EXECUTE') AS exec,
           EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                   WHERE p.proname = 'expire_due_reservations' AND a.grantee = 0) AS pub
    FROM pg_roles r WHERE r.rolname = 'app_user'`;
  assert.deepEqual({ ...row }, { super: false, bypass: false, dml: true, exec: true, pub: false });
});

test("migrate: اجرای دوباره چیزی را عوض نمی‌کند", () => {
  const r = migrate(ADMIN);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 migration تازه/);
});

test("migrate: با نقش app_user اجرا نمی‌شود و دلیلش را می‌گوید", () => {
  const r = migrate(process.env.DATABASE_URL!);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /MIGRATION_DATABASE_URL/);
});

test("migrate: تغییر فایل اجراشده را حتی وقتی چیزی برای اجرا نیست می‌گیرد", async () => {
  await sql`UPDATE _migrations SET checksum = 'tampered' WHERE id = 5`;
  const r = migrate(ADMIN);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /0005_tenant_features\.sql/);
  await resetSchema(); // فایل‌های بعدی با schema سالم شروع کنند
});
