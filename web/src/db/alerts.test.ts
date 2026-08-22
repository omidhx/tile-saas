import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { subscribeAlert, listAlertsAndOutOfStock } from "./alerts";
import { applySnapshot } from "./imports";
import { sendPendingNotifications } from "./outbox";
import { T, seedTenant } from "./_fixtures";

const U = "a8888888-8888-8888-8888-888888888888";
const AG = "a5555555-5555-5555-5555-555555555555";
const VAR = "a2222222-2222-2222-2222-222222222222";
const WH = "a3333333-3333-3333-3333-333333333333";

before(async () => {
  await resetSchema();
  await seedTenant();
  await sql.unsafe(`
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','09121112222','x');
    INSERT INTO tenant_membership (tenant_id,user_id,role,is_active) VALUES ('${T}','${U}','agent',true);
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
    INSERT INTO agent_account_user (tenant_id,agent_account_id,user_id,role) VALUES ('${T}','${AG}','${U}','op');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','GB-6060','گرانیت مشکی');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${VAR}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','W','W1','main');
  `);
});
after(async () => { await sql.end(); });

const outboxRows = async () =>
  sql<{ recipient: string; status: string; payload: Record<string, unknown> }[]>`
    SELECT recipient, status, payload FROM notification_outbox ORDER BY created_at`;

test("variant بدون هیچ lot، ناموجود شمرده می‌شود و قابل اشتراک است", async () => {
  const before = await listAlertsAndOutOfStock({ tenantId: T, agentAccountId: AG });
  assert.equal(before.outOfStock.length, 1, "variantِ بدون موجودی باید ناموجود باشد");
  assert.equal(before.subscribed.length, 0);

  await subscribeAlert({ tenantId: T, agentAccountId: AG, variantId: VAR });
  const after = await listAlertsAndOutOfStock({ tenantId: T, agentAccountId: AG });
  assert.deepEqual(after.subscribed, [VAR]);
});

test("import که موجودی می‌آورد → پیام در همان تراکنش صف می‌شود و alert مصرف می‌شود", async () => {
  const res = await applySnapshot({
    tenantId: T, uploaderUserId: U, idempotencyKey: "alert-1",
    scope: { type: "warehouse", warehouseId: WH },
    rows: [{ sku: "S1", warehouseCode: "W1", batchNumber: "B1", onHand: 50 }],
  });
  assert.equal(res.applied, 1);
  assert.equal(res.notified, 1, "باید ۱ پیام صف شده باشد");

  const rows = await outboxRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].recipient, "09121112222", "به شماره‌ی کاربرِ همان نمایندگی");
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].payload.type, "restock");

  // alert یک‌بارمصرف است → مصرف شد
  const after = await listAlertsAndOutOfStock({ tenantId: T, agentAccountId: AG });
  assert.deepEqual(after.subscribed, [], "alert باید بعد از شلیک حذف شده باشد");
  assert.equal(after.outOfStock.length, 0, "دیگر ناموجود نیست");
});

test("worker پیام pending را می‌فرستد و sent علامت می‌زند", async () => {
  const { sent, failed } = await sendPendingNotifications();
  assert.equal(sent, 1);
  assert.equal(failed, 0);

  const rows = await outboxRows();
  assert.equal(rows[0].status, "sent");

  // اجرای دوباره نباید چیزی بفرستد (idempotent در عمل)
  const again = await sendPendingNotifications();
  assert.equal(again.sent, 0, "پیامِ ارسال‌شده نباید دوباره برداشته شود");
});

test("importِ تکراری (dedupe) پیام جدید صف نمی‌کند", async () => {
  const countBefore = (await outboxRows()).length;
  const res = await applySnapshot({
    tenantId: T, uploaderUserId: U, idempotencyKey: "alert-1", // همان کلید
    scope: { type: "warehouse", warehouseId: WH },
    rows: [{ sku: "S1", warehouseCode: "W1", batchNumber: "B1", onHand: 99 }],
  });
  assert.equal(res.deduped, true);
  assert.equal((await outboxRows()).length, countBefore, "dedupe نباید پیام جدید بسازد");
});
