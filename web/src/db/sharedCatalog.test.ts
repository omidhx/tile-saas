import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import {
  createCatalog, listCatalogs, setCatalogActive, deleteCatalog, getPublicCatalog,
} from "./sharedCatalog";

/**
 * کاتالوگ سفارشی. چیزی که تست‌ها باید ثابت کنند «کار می‌کند» نیست — **امن است**:
 *   • token و slug باید به یک tenant برسند، وگرنه هیچ.
 *   • لینکِ باطل‌شده هیچ نشان نمی‌دهد.
 *   • نماینده نمی‌تواند کاتالوگِ نماینده‌ی دیگر را باطل/حذف کند.
 */

const T = "11111111-1111-1111-1111-111111111111";
const U = "a8888888-8888-8888-8888-888888888888";
const A1 = "a5555555-5555-5555-5555-555555555551";
const A2 = "a5555555-5555-5555-5555-555555555552";
const WH = "a3333333-3333-3333-3333-333333333333";
const V1 = "a2222222-2222-2222-2222-222222222221"; // موجود
const V2 = "a2222222-2222-2222-2222-222222222222"; // ناموجود
const LOT = "a4444444-4444-4444-4444-444444444444";

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','کارخانه','nem');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','0910','x');
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES
      ('${A1}','${T}','نماینده یک','AG1'), ('${A2}','${T}','نماینده دو','AG2');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','W','W1','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P','کالا');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES
      ('${V1}','${T}','a1111111-1111-1111-1111-111111111111','S1'),
      ('${V2}','${T}','a1111111-1111-1111-1111-111111111111','S2');
    -- فقط V1 موجودی دارد
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES ('${LOT}','${T}','${V1}','${WH}');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT}',50);
  `);
});
after(async () => { await sql.end(); });
beforeEach(async () => { await sql`DELETE FROM shared_catalog WHERE tenant_id = ${T}`; });

test("ساخت + فهرست: تعدادِ آیتم درست است", async () => {
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "پیشنهاد لابی", variantIds: [V1, V2], token: "tok-1" });
  const list = await listCatalogs(T, A1);
  assert.equal(list.length, 1);
  assert.equal(list[0].itemCount, 2);
  assert.equal(list[0].token, "tok-1");
  assert.equal(list[0].isActive, true);
});

test("نمای عمومی با slug+token: آیتم‌ها + موجود/ناموجودِ درست، بدونِ قیمت", async () => {
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "کاتالوگ", variantIds: [V1, V2], token: "tok-2" });
  const pub = await getPublicCatalog({ slug: "nem", token: "tok-2" });
  assert.ok(pub);
  assert.equal(pub.title, "کاتالوگ");
  assert.equal(pub.items.length, 2);
  // هر دو variant زیرِ یک product‌اند، پس فقط چک می‌کنیم هم موجود و هم ناموجود در نتیجه هست
  const flags = pub.items.map((i) => i.inStock).sort();
  assert.deepEqual(flags, [false, true]);
  // قیمت اصلاً در خروجی نیست (شکلِ PublicItem قیمت ندارد)
  assert.ok(!("unitPrice" in pub.items[0]));
});

test("🔴 امنیت: token با slugِ اشتباه → null (token مالِ tenant دیگر بی‌فایده است)", async () => {
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "x", variantIds: [V1], token: "tok-3" });
  assert.equal(await getPublicCatalog({ slug: "ناموجود", token: "tok-3" }), null);
});

test("🔴 امنیت: لینکِ باطل‌شده → null", async () => {
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "x", variantIds: [V1], token: "tok-4" });
  const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM shared_catalog WHERE token = 'tok-4'`;
  await setCatalogActive({ tenantId: T, agentAccountId: A1, id, isActive: false });
  assert.equal(await getPublicCatalog({ slug: "nem", token: "tok-4" }), null);
});

test("🔴 امنیت: نماینده‌ی دیگر نمی‌تواند کاتالوگِ من را باطل یا حذف کند", async () => {
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "مالِ A1", variantIds: [V1], token: "tok-5" });
  const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM shared_catalog WHERE token = 'tok-5'`;

  // A2 تلاش می‌کند باطل کند — نباید اثر کند
  await setCatalogActive({ tenantId: T, agentAccountId: A2, id, isActive: false });
  assert.ok(await getPublicCatalog({ slug: "nem", token: "tok-5" }), "هنوز فعال است");

  // A2 تلاش می‌کند حذف کند — نباید اثر کند
  await deleteCatalog({ tenantId: T, agentAccountId: A2, id });
  assert.equal((await listCatalogs(T, A1)).length, 1, "هنوز هست");

  // خودِ A1 حذف می‌کند — می‌رود
  await deleteCatalog({ tenantId: T, agentAccountId: A1, id });
  assert.equal((await listCatalogs(T, A1)).length, 0);
});
