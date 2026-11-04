import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { T, U, seedTenantUser } from "./_fixtures";
import { getTenantSettings, updateTenantSettings } from "./tenantSettings";

/**
 * تنظیماتِ کارخانه (TTL رزرو + لوگو). قاعده‌ی اصلی که تست‌ها قفلش می‌کنند: فقط
 * فیلدی که واقعاً عوض شده در audit_log ثبت می‌شود (همان الگوی product.edit) —
 * ست‌کردنِ همان مقدارِ قبلی نباید ردپای بی‌فایده بسازد.
 */

before(async () => {
  await resetSchema();
  await seedTenantUser();
});
after(async () => { await sql.end(); });

test("پیش‌فرض: TTLِ ۲۴ ساعت، بدونِ لوگو، واحدِ نمایش ریال", async () => {
  const s = await getTenantSettings(T);
  assert.equal(s?.ttlHours, 24);
  assert.equal(s?.logoUrl, null);
  assert.equal(s?.currencyUnit, "rial");
});

test("تغییرِ واحدِ نمایش به تومان ذخیره و ردپا می‌شود، بدونِ دست‌زدن به بقیه‌ی تنظیمات", async () => {
  const before = await getTenantSettings(T);
  await updateTenantSettings({ tenantId: T, actorUserId: U, currencyUnit: "toman" });
  const s = await getTenantSettings(T);
  assert.equal(s?.currencyUnit, "toman");
  assert.equal(s?.ttlHours, before?.ttlHours, "دست‌نخورده ماند");
  assert.equal(s?.logoUrl, before?.logoUrl, "دست‌نخورده ماند");

  const [row] = await sql`
    SELECT old_value AS "old", new_value AS "new" FROM audit_log
    WHERE tenant_id = ${T} AND action = 'tenant_settings.edit' AND entity_id = ${T}
    ORDER BY created_at DESC LIMIT 1`;
  assert.equal(row.old.currencyUnit, "rial");
  assert.equal(row.new.currencyUnit, "toman");
  assert.equal("ttlHours" in row.new, false, "فیلدِ دست‌نخورده نباید در ردپا باشد");

  await updateTenantSettings({ tenantId: T, actorUserId: U, currencyUnit: "rial" }); // برگرداندن برای تست‌های بعدی
});

test("تغییرِ TTL ذخیره و در audit_log ثبت می‌شود", async () => {
  await updateTenantSettings({ tenantId: T, actorUserId: U, ttlHours: 48 });
  const s = await getTenantSettings(T);
  assert.equal(s?.ttlHours, 48);

  const [row] = await sql`
    SELECT old_value AS "old", new_value AS "new" FROM audit_log
    WHERE tenant_id = ${T} AND action = 'tenant_settings.edit' AND entity_id = ${T}
    ORDER BY created_at DESC LIMIT 1`;
  assert.equal(row.old.ttlHours, 24);
  assert.equal(row.new.ttlHours, 48);
  assert.equal("logoUrl" in row.new, false, "فیلدِ دست‌نخورده نباید در ردپا باشد");
});

test("تنظیمِ لوگو و حذفِ دوباره‌اش، هرکدام جدا ردپا می‌گذارد", async () => {
  await updateTenantSettings({ tenantId: T, actorUserId: U, logoUrl: "/uploads/logo.png" });
  let s = await getTenantSettings(T);
  assert.equal(s?.logoUrl, "/uploads/logo.png");

  await updateTenantSettings({ tenantId: T, actorUserId: U, logoUrl: null });
  s = await getTenantSettings(T);
  assert.equal(s?.logoUrl, null);

  const rows = await sql`
    SELECT new_value AS "new" FROM audit_log
    WHERE tenant_id = ${T} AND action = 'tenant_settings.edit' AND entity_id = ${T}
    ORDER BY created_at DESC LIMIT 2`;
  assert.equal(rows[0].new.logoUrl, null);
  assert.equal(rows[1].new.logoUrl, "/uploads/logo.png");
});

test("ست‌کردنِ همان مقدارِ قبلی هیچ ردپای تازه‌ای نمی‌سازد", async () => {
  const before = await getTenantSettings(T);
  const [{ n: n0 }] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = ${T} AND action = 'tenant_settings.edit'`;

  await updateTenantSettings({ tenantId: T, actorUserId: U, ttlHours: before!.ttlHours, logoUrl: before!.logoUrl });

  const [{ n: n1 }] = await sql`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = ${T} AND action = 'tenant_settings.edit'`;
  assert.equal(n1, n0, "بدونِ تغییرِ واقعی، ردپای جدید نباید ساخته شود");
});
