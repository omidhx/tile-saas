import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { T, U, seedTenantUser } from "./_fixtures";
import { getSmsConfig, getSmsConfigForSending, updateSmsConfig } from "./smsConfig";

/**
 * پنلِ پیامکیِ کارخانه. قواعدی که تست‌ها قفلش می‌کنند:
 *   • apiKey/password هرگز خام از getSmsConfig برنمی‌گردد — فقط ماسک‌شده.
 *   • getSmsConfigForSending (مسیرِ داخلیِ worker) رمزگشایی‌شده برمی‌گرداند و باید
 *     دقیقاً همان مقداریست که ست شده — رمزنگاری نباید چیزی را عوض کند.
 *   • خودِ راز هیچ‌وقت در audit_log نمی‌رود.
 */

before(async () => {
  await resetSchema();
  await seedTenantUser();
});
after(async () => { await sql.end(); });

test("پیش‌فرض: خاموش، بدونِ پروایدر", async () => {
  const c = await getSmsConfig(T);
  assert.equal(c.enabled, false);
  assert.equal(c.provider, null);
  assert.equal(await getSmsConfigForSending(T), null);
});

test("ذخیره‌ی کلیدِ API فقط ماسک‌شده برمی‌گردد، ولی برای ارسال رمزگشایی می‌شود", async () => {
  await updateSmsConfig({
    tenantId: T, actorUserId: U, provider: "kavenegar", apiKey: "sekret-abcd1234", senderNumber: "3000123",
  });

  const view = await getSmsConfig(T);
  assert.equal(view.provider, "kavenegar");
  assert.equal(view.apiKeyMasked, "••••1234");

  const forSending = await getSmsConfigForSending(T);
  assert.equal(forSending?.credentials.apiKey, "sekret-abcd1234");
  assert.equal(forSending?.credentials.senderNumber, "3000123");
});

test("راز در audit_log نمی‌رود — فقط این‌که تغییر کرد", async () => {
  const [row] = await sql`
    SELECT new_value AS "new" FROM audit_log
    WHERE tenant_id = ${T} AND action = 'sms_config.edit' ORDER BY created_at DESC LIMIT 1`;
  assert.equal(row.new.credentials, "تغییر کرد");
  assert.equal(JSON.stringify(row.new).includes("sekret"), false);
});

test("فعال/غیرفعال‌کردن بدونِ دست‌زدن به بقیه‌ی تنظیمات", async () => {
  await updateSmsConfig({ tenantId: T, actorUserId: U, enabled: true });
  let c = await getSmsConfig(T);
  assert.equal(c.enabled, true);
  assert.equal(c.provider, "kavenegar"); // دست‌نخورده ماند

  const forSending = await getSmsConfigForSending(T);
  assert.equal(forSending?.enabled, true);

  await updateSmsConfig({ tenantId: T, actorUserId: U, enabled: false });
  c = await getSmsConfig(T);
  assert.equal(c.enabled, false);
});

test("پترنِ یک نوع بدونِ پاک‌کردنِ بقیه‌ی نوع‌ها ذخیره می‌شود", async () => {
  await updateSmsConfig({ tenantId: T, actorUserId: U, patterns: { password_reset: { patternCode: "1001" } } });
  await updateSmsConfig({ tenantId: T, actorUserId: U, patterns: { restock: { patternCode: "2002" } } });

  const c = await getSmsConfig(T);
  assert.equal(c.patterns.password_reset?.patternCode, "1001");
  assert.equal(c.patterns.restock?.patternCode, "2002");
});
