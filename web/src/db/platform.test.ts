import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { createTenant } from "./platform";

before(async () => { await resetSchema(); });
after(async () => { await sql.end(); });

test("createTenant: کارخانه + اولین admin با can_manage_access ساخته می‌شوند", async () => {
  const r = await createTenant({ name: "کارخانه‌ی الف", slug: "factory-a", adminPhone: "09121110001" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.ok(r.tempPassword, "کاربرِ تازه باید رمزِ یک‌بارمصرف بگیرد");

  const [t] = await sql<{ name: string; slug: string }[]>`SELECT name, slug FROM tenant WHERE id = ${r.tenantId}`;
  assert.equal(t.slug, "factory-a");

  const [m] = await sql<{ role: string; can_manage_access: boolean }[]>`
    SELECT role, can_manage_access FROM tenant_membership WHERE tenant_id = ${r.tenantId}`;
  assert.equal(m.role, "admin");
  assert.equal(m.can_manage_access, true, "اولین مدیر باید بتواند دسترسیِ بقیه را هم تنظیم کند");
});

test("createTenant: اسلاگِ تکراری رد می‌شود", async () => {
  await createTenant({ name: "ب", slug: "factory-b", adminPhone: "09121110002" });
  const r2 = await createTenant({ name: "ب دوم", slug: "factory-b", adminPhone: "09121110003" });
  assert.deepEqual(r2, { ok: false, reason: "slug_taken" });
});

test("createTenant: موبایلِ موجود همان کاربر را وصل می‌کند، بدونِ رمزِ تازه", async () => {
  const first = await createTenant({ name: "ج", slug: "factory-c", adminPhone: "09121110004" });
  assert.ok(first.ok);
  const second = await createTenant({ name: "د", slug: "factory-d", adminPhone: "09121110004" });
  assert.ok(second.ok);
  if (!second.ok) return;
  assert.equal(second.tempPassword, null, "کاربرِ از‌قبل‌موجود رمزِ تازه نمی‌گیرد");
});

test("createTenant: شکستِ ایمیلِ تکراری، کلِ تراکنش (از جمله خودِ tenant) را رول‌بک می‌کند", async () => {
  await createTenant({ name: "ه", slug: "factory-e", adminPhone: "09121110005", adminEmail: "dup@example.com" });
  const before_ = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM tenant`;
  const r = await createTenant({
    name: "یتیم", slug: "factory-orphan", adminPhone: "09121110006", adminEmail: "dup@example.com",
  });
  assert.deepEqual(r, { ok: false, reason: "email_taken" });
  const after_ = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM tenant`;
  assert.equal(after_[0].n, before_[0].n, "tenantِ یتیم نباید بمانَد");
  const [orphan] = await sql`SELECT 1 FROM tenant WHERE slug = 'factory-orphan'`;
  assert.equal(orphan, undefined);
});

test("createTenant: نام/اسلاگ/موبایلِ خالی رد می‌شود", async () => {
  assert.deepEqual(await createTenant({ name: "", slug: "x", adminPhone: "09121110007" }), { ok: false, reason: "invalid" });
  assert.deepEqual(await createTenant({ name: "x", slug: "", adminPhone: "09121110007" }), { ok: false, reason: "invalid" });
  assert.deepEqual(await createTenant({ name: "x", slug: "y", adminPhone: "" }), { ok: false, reason: "invalid" });
});
