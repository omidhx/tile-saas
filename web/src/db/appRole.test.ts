import { test, before } from "node:test";
import assert from "node:assert/strict";
import { sql, appSql, resetSchema } from "./_testdb";
import { withTenant } from "./client";

// پایه‌ی بقیه‌ی تست‌ها: اگر این‌ها قرمز شوند، سبزی هیچ تست ایزوله‌ای معنا ندارد.
// resetSchema همین چک نقش را قبل از هر تست DB هم انجام می‌دهد.

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${A}','A','a'), ('${B}','B','b');
    INSERT INTO product (tenant_id,code,name) VALUES ('${A}','P1','A1'), ('${B}','P1','B1');
  `);
});

test("نقش تست superuser نیست و BYPASSRLS ندارد", async () => {
  const [role] = await appSql<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  assert.deepEqual({ ...role }, { current_user: "app_user", rolsuper: false, rolbypassrls: false });
});

test("هر جدول دارای tenant_id: RLS فعال، FORCE و دارای policy", async () => {
  const rows = await sql<{ table: string; enabled: boolean; forced: boolean; policies: number }[]>`
    SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
           (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
    WHERE c.relkind = 'r'`;
  assert.ok(rows.length >= 30, `انتظار حداقل ۳۰ جدول، پیدا شد ${rows.length}`);
  const broken = rows.filter((r) => !r.enabled || !r.forced || r.policies === 0).map((r) => r.table);
  assert.deepEqual(broken, []);
});

test("RLS: بدون app.tenant_id هیچ ردیفی دیده نمی‌شود", async () => {
  const rows = await appSql`SELECT id FROM product`;
  assert.equal(rows.length, 0);
});

test("RLS: با tenant A، بدون فیلتر صریح فقط ردیف‌های A دیده می‌شوند", async () => {
  const rows = await withTenant(A, (tx) => tx<{ name: string }[]>`SELECT name FROM product`);
  assert.deepEqual(rows.map((r) => r.name), ["A1"]);
});

test("RLS: UPDATE و DELETE بدون فیلتر صریح به ردیف tenant دیگر نمی‌رسد", async () => {
  await withTenant(A, (tx) => tx`UPDATE product SET name = 'hacked' WHERE name = 'B1'`);
  await withTenant(A, (tx) => tx`DELETE FROM product WHERE name = 'B1'`);
  const rows = await sql<{ name: string }[]>`SELECT name FROM product WHERE tenant_id = ${B}`;
  assert.deepEqual(rows.map((r) => r.name), ["B1"]);
});

test("RLS: INSERT برای tenant دیگر رد می‌شود", async () => {
  await assert.rejects(() =>
    withTenant(A, (tx) => tx`INSERT INTO product (tenant_id,code,name) VALUES (${B},'P2','x')`));
});
