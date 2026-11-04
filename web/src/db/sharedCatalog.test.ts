import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import {
  createCatalog, updateCatalog, listCatalogs, setCatalogActive, deleteCatalog, getPublicCatalog,
} from "./sharedCatalog";

// کمک‌کننده: variantIds → آیتم بدونِ قیمت
const noPrice = (...ids: string[]) => ids.map((variantId) => ({ variantId, customerPrice: null }));

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
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "پیشنهاد لابی", items: noPrice(V1, V2), token: "tok-1" });
  const list = await listCatalogs(T, A1);
  assert.equal(list.length, 1);
  assert.equal(list[0].items.length, 2);
  assert.equal(list[0].token, "tok-1");
  assert.equal(list[0].isActive, true);
});

test("showDetails: توضیحاتِ اضافه فقط با opt-in به مشتری می‌رود؛ گالری همیشه", async () => {
  await sql`UPDATE product SET description = 'کاشیِ کف', size = '۶۰×۶۰' WHERE tenant_id = ${T} AND code = 'P'`;
  await sql`INSERT INTO product_image (tenant_id, product_id, url)
            SELECT ${T}, id, 'https://cdn/x.jpg' FROM product WHERE tenant_id = ${T} AND code = 'P'
            ON CONFLICT DO NOTHING`;

  await createCatalog({ tenantId: T, agentAccountId: A1, title: "بدون", items: noPrice(V1), token: "tok-sd1" });
  let pub = await getPublicCatalog({ slug: "nem", token: "tok-sd1" });
  assert.ok(pub);
  assert.equal(pub.showDetails, false);
  assert.equal(pub.items[0].description, null, "بدونِ opt-in، توضیحات به مشتری نمی‌رود");
  assert.equal(pub.items[0].size, null);
  assert.ok(pub.items[0].images.length >= 1, "گالری همیشه می‌آید، مستقل از showDetails");

  await createCatalog({ tenantId: T, agentAccountId: A1, title: "با", items: noPrice(V1), token: "tok-sd2", showDetails: true });
  pub = await getPublicCatalog({ slug: "nem", token: "tok-sd2" });
  assert.ok(pub);
  assert.equal(pub.items[0].description, "کاشیِ کف");
  assert.equal(pub.items[0].size, "۶۰×۶۰");
});

test("قیمتِ فروشِ مشتری: در فهرست و نمای عمومی می‌آید؛ null یعنی بدونِ قیمت", async () => {
  await createCatalog({
    tenantId: T, agentAccountId: A1, title: "قیمت‌دار", token: "tok-p",
    items: [{ variantId: V1, customerPrice: 6_500_000 }, { variantId: V2, customerPrice: null }],
  });
  // در فهرستِ نماینده
  const [c] = await listCatalogs(T, A1);
  const byV = Object.fromEntries(c.items.map((i) => [i.variantId, i.customerPrice]));
  assert.equal(byV[V1], 6_500_000, "عدد، نه رشته‌ی bigint");
  assert.equal(byV[V2], null);
  // در نمای عمومی
  const pub = await getPublicCatalog({ slug: "nem", token: "tok-p" });
  assert.ok(pub);
  const prices = pub.items.map((i) => i.customerPrice).sort((a, b) => (a ?? 0) - (b ?? 0));
  assert.deepEqual(prices, [null, 6_500_000]);
});

test("ویرایش: عنوان و آیتم‌ها جای‌گزین می‌شوند، token دست‌نخورده می‌ماند", async () => {
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "قبلی", items: noPrice(V1), token: "tok-e" });
  const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM shared_catalog WHERE token = 'tok-e'`;

  await updateCatalog({
    tenantId: T, agentAccountId: A1, id, title: "جدید",
    items: [{ variantId: V2, customerPrice: 900_000 }],
  });
  const [c] = await listCatalogs(T, A1);
  assert.equal(c.title, "جدید");
  assert.equal(c.token, "tok-e", "token عوض نمی‌شود تا لینک معتبر بماند");
  assert.equal(c.items.length, 1);
  assert.equal(c.items[0].variantId, V2);
  assert.equal(c.items[0].customerPrice, 900_000);
});

test("🔴 امنیت: نماینده‌ی دیگر نمی‌تواند کاتالوگِ من را ویرایش کند", async () => {
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "مالِ A1", items: noPrice(V1), token: "tok-e2" });
  const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM shared_catalog WHERE token = 'tok-e2'`;
  await updateCatalog({ tenantId: T, agentAccountId: A2, id, title: "دستکاری", items: noPrice(V2) });
  const [c] = await listCatalogs(T, A1);
  assert.equal(c.title, "مالِ A1", "بی‌اثر");
  assert.equal(c.items[0].variantId, V1, "آیتم‌ها دست‌نخورده");
});

test("نمای عمومی با slug+token: آیتم‌ها + موجود/ناموجودِ درست، بدونِ قیمت", async () => {
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "کاتالوگ", items: noPrice(V1, V2), token: "tok-2" });
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
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "x", items: noPrice(V1), token: "tok-3" });
  assert.equal(await getPublicCatalog({ slug: "ناموجود", token: "tok-3" }), null);
});

test("🔴 امنیت: لینکِ باطل‌شده → null", async () => {
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "x", items: noPrice(V1), token: "tok-4" });
  const [{ id }] = await sql<{ id: string }[]>`SELECT id FROM shared_catalog WHERE token = 'tok-4'`;
  await setCatalogActive({ tenantId: T, agentAccountId: A1, id, isActive: false });
  assert.equal(await getPublicCatalog({ slug: "nem", token: "tok-4" }), null);
});

test("🔴 امنیت: نماینده‌ی دیگر نمی‌تواند کاتالوگِ من را باطل یا حذف کند", async () => {
  await createCatalog({ tenantId: T, agentAccountId: A1, title: "مالِ A1", items: noPrice(V1), token: "tok-5" });
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
