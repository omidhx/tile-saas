import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql, withTenant } from "./client";
import { resetSchema } from "./_testdb";
import { writeAudit, listAudit } from "./audit";

/**
 * دفترِ تغییراتِ قواعدِ پولی. چیزی که اهمیت دارد این است که ردپا **در همان
 * تراکنشِ تغییر** نوشته شود — وگرنه تغییرِ موفق با ردپای گم‌شده ممکن می‌شود،
 * یعنی دقیقاً حالتی که این جدول برای جلوگیری‌اش هست.
 */

const T = "11111111-1111-1111-1111-111111111111";
const U = "a8888888-8888-8888-8888-888888888888";
const V = "a2222222-2222-2222-2222-222222222222";
const PL = "aaaa1111-1111-1111-1111-111111111111";

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','کارخانه','a');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','09120000001','x');
    INSERT INTO price_list (id,tenant_id,name) VALUES ('${PL}','${T}','L');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','گرانیت');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${V}','${T}','a1111111-1111-1111-1111-111111111111','S1');
  `);
});
after(async () => { await sql.end(); });
beforeEach(async () => { await sql`DELETE FROM audit_log WHERE tenant_id = ${T}`; });

test("ردپا با مقدارِ قبلی و بعدی ثبت می‌شود", async () => {
  await withTenant(T, (tx) => writeAudit(tx, {
    tenantId: T, actorUserId: U, action: "price.set",
    entity: "price_list_item", entityId: V, oldValue: 8_500_000, newValue: 850_000,
  }));

  const [row] = (await listAudit({ tenantId: T })).items;
  assert.equal(row.action, "price.set");
  assert.equal(row.oldValue, 8_500_000, "«از چند آمد» مهم‌ترین بخشِ ردپاست");
  assert.equal(row.newValue, 850_000);
  assert.equal(row.actorPhone, "09120000001", "«چه کسی» باید خوانا باشد نه UUID");
  assert.equal(row.label, "گرانیت", "برچسبِ خوانا، نه فقط شناسه");
});

test("🔴 ردپا با تغییر در یک تراکنش است — رول‌بک هر دو را می‌برد", async () => {
  await assert.rejects(
    withTenant(T, async (tx) => {
      await tx`INSERT INTO price_list_item (tenant_id,price_list_id,variant_id,price)
               VALUES (${T},${PL},${V},1000)`;
      await writeAudit(tx, {
        tenantId: T, actorUserId: U, action: "price.set",
        entity: "price_list_item", entityId: V, oldValue: null, newValue: 1000,
      });
      throw new Error("boom");
    }),
  );

  const prices = await sql`SELECT 1 FROM price_list_item WHERE tenant_id = ${T}`;
  assert.equal(prices.length, 0, "قیمت نباید مانده باشد");
  assert.equal((await listAudit({ tenantId: T })).items.length, 0,
    "و ردپا هم نه — تغییرِ موفق با ردپای گم‌شده نباید ممکن باشد");
});

test("NULL معنیِ خودش را دارد و با صفر یکی نمی‌شود", async () => {
  await withTenant(T, async (tx) => {
    await writeAudit(tx, {
      tenantId: T, actorUserId: U, action: "auto_approve_limit.tenant",
      entity: "tenant", entityId: T, oldValue: null, newValue: 0,
    });
  });
  const [row] = (await listAudit({ tenantId: T })).items;
  assert.equal(row.oldValue, null, "«خاموش» باید NULL بماند");
  assert.equal(row.newValue, 0, "«هرگز خودکار» صفر است — و این دو یکی نیستند");
});

test("تازه‌ترین اول می‌آید", async () => {
  for (const p of [100, 200, 300])
    await withTenant(T, (tx) => writeAudit(tx, {
      tenantId: T, actorUserId: U, action: "price.set",
      entity: "price_list_item", entityId: V, oldValue: null, newValue: p,
    }));
  const rows = (await listAudit({ tenantId: T })).items;
  assert.equal(rows[0].newValue, 300, "آخرین تغییر باید بالای فهرست باشد");
});

test("دفترِ یک کارخانه به کارخانه‌ی دیگر نشت نمی‌کند", async () => {
  const T2 = "11111111-1111-1111-1111-111111111112";
  await sql`INSERT INTO tenant (id,name,slug) VALUES (${T2},'دیگری','b') ON CONFLICT DO NOTHING`;
  await withTenant(T, (tx) => writeAudit(tx, {
    tenantId: T, actorUserId: U, action: "price.set",
    entity: "price_list_item", entityId: V, oldValue: 1, newValue: 2,
  }));
  assert.equal((await listAudit({ tenantId: T2 })).items.length, 0);
  assert.equal((await listAudit({ tenantId: T })).items.length, 1);
});

test("listAudit: صفحه‌بندی (hasMore) + جستجو روی برچسبِ کالا", async () => {
  for (const p of [10, 20, 30])
    await withTenant(T, (tx) => writeAudit(tx, {
      tenantId: T, actorUserId: U, action: "price.set",
      entity: "price_list_item", entityId: V, oldValue: null, newValue: p,
    }));

  const total = (await listAudit({ tenantId: T, limit: 1000 })).items.length;
  assert.ok(total >= 3);

  const page1 = await listAudit({ tenantId: T, limit: total - 1 });
  assert.equal(page1.items.length, total - 1);
  assert.equal(page1.hasMore, true);

  const page2 = await listAudit({ tenantId: T, limit: total - 1, offset: total - 1 });
  assert.equal(page2.items.length, 1);
  assert.equal(page2.hasMore, false);

  const found = await listAudit({ tenantId: T, q: "گرانیت" });
  assert.equal(found.items.length, total, "همه روی همین یک کالا نوشته شده‌اند");
  const notFound = await listAudit({ tenantId: T, q: "چیزیِ نامرتبط" });
  assert.equal(notFound.items.length, 0);
});
