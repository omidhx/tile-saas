import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { createProduct, listProducts, updateProduct, addProductImage, removeProductImage, setPrimaryImage } from "./products";
import { T, seedTenant } from "./_fixtures";

/**
 * مدیریت محصول. قاعده‌ای که مهم است: ساختِ محصول باید هم‌زمان یک variant بسازد،
 * وگرنه محصولِ بی‌واریانت هرگز قابلِ سفارش نمی‌شود (تله‌ای که فرمِ ساده پنهانش می‌کند).
 */

const WH = "a3333333-3333-3333-3333-333333333333";
const U = "a8888888-8888-8888-8888-888888888888";

/** لیستِ کاملِ محصولات — تست‌ها با تعدادِ کم کار می‌کنند، صفحه‌بندی لازم ندارند. */
const list = async () => (await listProducts({ tenantId: T, limit: 1000 })).items;

before(async () => {
  await resetSchema();
  await seedTenant();
  await sql.unsafe(`INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','انبارِ اصلی','W1','main');`);
  await sql.unsafe(`INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','09120000001','x');`);
});
after(async () => { await sql.end(); });
beforeEach(async () => {
  // ترتیب مهم است: lot و price_list_item به variant قفل‌اند (RESTRICT، نه CASCADE) —
  // بدونِ پاک‌کردنِ اول لجر/بالانس/لات/قیمت، حذفِ variant با خطای FK رد می‌شود
  // (تستِ basePrice یک price_list_item می‌سازد که تستِ بعدی را همین‌جا گیر می‌انداخت).
  await sql`DELETE FROM inventory_transaction WHERE tenant_id = ${T}`;
  await sql`DELETE FROM inventory_balance WHERE tenant_id = ${T}`;
  await sql`DELETE FROM inventory_lot WHERE tenant_id = ${T}`;
  await sql`DELETE FROM price_list_item WHERE tenant_id = ${T}`;
  await sql`DELETE FROM price_list WHERE tenant_id = ${T}`;
  await sql`DELETE FROM product_variant WHERE tenant_id = ${T}`;
  await sql`DELETE FROM product WHERE tenant_id = ${T}`;
});

test("🔴 ساختِ محصول یک variant هم می‌سازد — وگرنه قابلِ سفارش نیست", async () => {
  const r = await createProduct(T, { name: "تسلا طوسی", code: "TS-6060", sku: "TS-6060-A", color: "طوسی" });
  assert.ok(r.ok);

  const [v] = await sql<{ sku: string }[]>`SELECT sku FROM product_variant WHERE product_id = ${r.id}`;
  assert.equal(v.sku, "TS-6060-A", "بدونِ variant، محصول در /reserve نمی‌آید");
});

test("کد و sku تکراری با پیامِ مشخص رد می‌شوند، نه خطای خام", async () => {
  await createProduct(T, { name: "A", code: "C1", sku: "S1" });
  assert.deepEqual(await createProduct(T, { name: "B", code: "C1", sku: "S2" }),
    { ok: false, reason: "duplicate_code" });
  assert.deepEqual(await createProduct(T, { name: "B", code: "C2", sku: "S1" }),
    { ok: false, reason: "duplicate_sku" });
});

test("نام/کد/sku الزامی‌اند", async () => {
  assert.deepEqual(await createProduct(T, { name: "  ", code: "C", sku: "S" }), { ok: false, reason: "missing" });
  assert.deepEqual(await createProduct(T, { name: "N", code: "", sku: "S" }), { ok: false, reason: "missing" });
});

test("فهرست: hasStock درست است، sku می‌آید", async () => {
  const r = await createProduct(T, { name: "کاشی", code: "K1", sku: "K1-A" });
  assert.ok(r.ok);
  const rows = await list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sku, "K1-A");
  assert.equal(rows[0].hasStock, false, "محصولِ تازه هنوز موجودی/lot ندارد");
});

test("ویرایشِ ویژگی‌ها، sku و کد را دست نمی‌زند", async () => {
  const r = await createProduct(T, { name: "قبلی", code: "E1", sku: "E1-A" });
  assert.ok(r.ok);
  await updateProduct({ tenantId: T, productId: r.id, actorUserId: U, name: "جدید", glaze: "ترانس" });
  const [p] = await sql<{ name: string; glaze: string; code: string }[]>`
    SELECT p.name, p.glaze, p.code FROM product p WHERE p.id = ${r.id}`;
  assert.equal(p.name, "جدید");
  assert.equal(p.glaze, "ترانس");
  assert.equal(p.code, "E1", "کد نباید عوض شود — کلیدِ تطبیق است");
});

test("🔴 ویرایشِ محصول ردپا می‌گذارد — فقط برای فیلدهای واقعاً تغییرکرده", async () => {
  const r = await createProduct(T, { name: "قبلی", code: "E2", sku: "E2-A", glaze: "براق" });
  assert.ok(r.ok);

  // glaze با همان مقدارِ قبلی دوباره فرستاده می‌شود — نباید در ردپا بیاید
  await updateProduct({ tenantId: T, productId: r.id, actorUserId: U, name: "جدید", glaze: "براق" });

  const [row] = await sql<{ oldValue: unknown; newValue: unknown; entity: string }[]>`
    SELECT old_value AS "oldValue", new_value AS "newValue", entity
    FROM audit_log WHERE tenant_id = ${T} AND action = 'product.edit' AND entity_id = ${r.id}`;
  assert.ok(row, "تغییرِ نام باید ردپا بگذارد");
  assert.equal(row.entity, "product");
  assert.deepEqual(row.oldValue, { name: "قبلی" }, "فقط فیلدِ واقعاً تغییرکرده وارد ردپا می‌شود");
  assert.deepEqual(row.newValue, { name: "جدید" });
});

test("ویرایشِ محصول بدونِ تغییرِ واقعی، ردپا نمی‌گذارد", async () => {
  const r = await createProduct(T, { name: "ثابت", code: "E3", sku: "E3-A" });
  assert.ok(r.ok);
  await updateProduct({ tenantId: T, productId: r.id, actorUserId: U, name: "ثابت" });
  const rows = await sql`SELECT 1 FROM audit_log WHERE tenant_id = ${T} AND action = 'product.edit' AND entity_id = ${r.id}`;
  assert.equal(rows.length, 0, "بدونِ تغییرِ واقعی، دفتر نباید پر شود");
});

test("گالری: افزودن چند عکس، عکسِ اصلی = تامنیل (image_url)، تعیینِ اصلی و حذف", async () => {
  const r = await createProduct(T, { name: "P", code: "P1", sku: "P1-A", imageUrl: "https://cdn/a.jpg" });
  assert.ok(r.ok);
  // عکسِ اولِ سازنده → گالری + کَشِ اصلی
  let p = (await list())[0];
  assert.equal(p.imageUrl, "https://cdn/a.jpg", "image_url = عکسِ اصلی");
  assert.equal(p.images.length, 1);

  await addProductImage({ tenantId: T, productId: r.id, url: "https://cdn/b.jpg" });
  p = (await list())[0];
  assert.equal(p.images.length, 2);
  assert.equal(p.imageUrl, "https://cdn/a.jpg", "اصلی هنوز a است");

  // b را اصلی کن → تامنیل عوض می‌شود
  const b = p.images.find((i) => i.url === "https://cdn/b.jpg")!;
  await setPrimaryImage({ tenantId: T, imageId: b.id });
  p = (await list())[0];
  assert.equal(p.imageUrl, "https://cdn/b.jpg", "اصلی حالا b");
  assert.equal(p.images[0].url, "https://cdn/b.jpg", "اولِ گالری = اصلی");

  // حذفِ اصلی → عکسِ بعدی خودکار اصلی
  await removeProductImage({ tenantId: T, imageId: b.id });
  p = (await list())[0];
  assert.equal(p.images.length, 1);
  assert.equal(p.imageUrl, "https://cdn/a.jpg", "بعدِ حذفِ اصلی، a اصلی شد");

  // افزودنِ تکراری بی‌اثر است (idempotent)
  await addProductImage({ tenantId: T, productId: r.id, url: "https://cdn/a.jpg" });
  assert.equal((await list())[0].images.length, 1);

  // حذفِ آخری → بدونِ عکس
  await removeProductImage({ tenantId: T, imageId: (await list())[0].images[0].id });
  p = (await list())[0];
  assert.equal(p.images.length, 0);
  assert.equal(p.imageUrl, null, "گالریِ خالی → تامنیلِ null");
});

test("ویرایشِ فیلدهای اطلاعاتِ بیشتر (ابعاد/ضخامت/کاربری/توضیحات)", async () => {
  const r = await createProduct(T, { name: "P", code: "P2", sku: "P2-A", size: "۶۰×۶۰", description: "کاشیِ کف" });
  assert.ok(r.ok);
  let p = (await list()).find((x) => x.code === "P2")!;
  assert.equal(p.size, "۶۰×۶۰");
  assert.equal(p.description, "کاشیِ کف");
  await updateProduct({ tenantId: T, productId: r.id, actorUserId: U, thickness: "۹ میلی‌متر", usageArea: "کف/دیوار", size: "" });
  p = (await list()).find((x) => x.code === "P2")!;
  assert.equal(p.thickness, "۹ میلی‌متر");
  assert.equal(p.usageArea, "کف/دیوار");
  assert.equal(p.size, null, "رشته‌ی خالی → null");
  assert.equal(p.description, "کاشیِ کف", "توضیحات دست‌نخورده چون undefined بود");
});

test("بسته‌بندی: در ساخت ثبت می‌شود؛ در ویرایش فقط با variantId عوض می‌شود", async () => {
  const r = await createProduct(T, { name: "P", code: "P3", sku: "P3-A", boxesPerPallet: 48, sqcmPerBox: 3600 });
  assert.ok(r.ok);
  let p = (await list()).find((x) => x.code === "P3")!;
  assert.equal(p.boxesPerPallet, 48);
  assert.equal(p.sqcmPerBox, 3600);

  // بدونِ variantId، آپدیت بسته‌بندی نادیده گرفته می‌شود — نه خطا، فقط بی‌اثر
  await updateProduct({ tenantId: T, productId: r.id, actorUserId: U, boxesPerPallet: 96 });
  p = (await list()).find((x) => x.code === "P3")!;
  assert.equal(p.boxesPerPallet, 48, "بدونِ variantId دست‌نخورده می‌ماند");

  // با variantId درست عوض می‌شود
  await updateProduct({ tenantId: T, productId: r.id, actorUserId: U, variantId: p.variantId!, boxesPerPallet: 96, sqcmPerBox: null });
  p = (await list()).find((x) => x.code === "P3")!;
  assert.equal(p.boxesPerPallet, 96);
  assert.equal(p.sqcmPerBox, null, "null صریح یعنی پاک‌کردن");
});

test("موجودیِ اولیه: ساختِ محصول با انبار+تعداد یک lot با on_hand همان تعداد می‌سازد و hasStock=true می‌شود", async () => {
  const actor = "22222222-2222-2222-2222-222222222222";
  await sql.unsafe(`INSERT INTO app_user (id,phone,password_hash) VALUES ('${actor}','09120000099','x') ON CONFLICT DO NOTHING;`);
  const r = await createProduct(T, {
    name: "کاشیِ باموجودی", code: "PS1", sku: "PS1-A",
    initialStock: { warehouseId: WH, quantityBoxes: 100 },
  }, actor);
  assert.ok(r.ok);

  const p = (await list()).find((x) => x.code === "PS1")!;
  assert.equal(p.hasStock, true, "بدونِ این، دقیقاً همان گزارشِ کاربر تکرار می‌شد");

  const [lot] = await sql<{ id: string }[]>`SELECT id FROM inventory_lot WHERE variant_id = ${p.variantId}`;
  const [bal] = await sql<{ on_hand_qty_boxes: number }[]>`
    SELECT on_hand_qty_boxes FROM inventory_balance WHERE lot_id = ${lot.id}`;
  assert.equal(bal.on_hand_qty_boxes, 100);

  const [txn] = await sql<{ transaction_type: string; actor_user_id: string }[]>`
    SELECT transaction_type, actor_user_id FROM inventory_transaction WHERE lot_id = ${lot.id}`;
  assert.equal(txn.transaction_type, "initial_stock");
  assert.equal(txn.actor_user_id, actor, "برای ردِ حسابرسی — چه کسی موجودی زده");
});

test("موجودیِ اولیه: بدونِ initialStock محصول همچنان بدونِ lot می‌ماند (بدون رگرسیون)", async () => {
  const r = await createProduct(T, { name: "بدون‌موجودی", code: "PS2", sku: "PS2-A" });
  assert.ok(r.ok);
  const p = (await list()).find((x) => x.code === "PS2")!;
  assert.equal(p.hasStock, false);
});

test("basePrice از اولین لیستِ قیمت می‌آید (نمایشی، نه ویرایش)", async () => {
  const r = await createProduct(T, { name: "قیمت‌دار", code: "PR1", sku: "PR1-A" });
  assert.ok(r.ok);
  // بدونِ لیست قیمت، basePrice باید null باشد
  assert.equal((await list()).find((p) => p.code === "PR1")!.basePrice, null);

  // یک لیست + قیمت
  const [pl] = await sql<{ id: string }[]>`INSERT INTO price_list (tenant_id,name) VALUES (${T},'پایه') RETURNING id`;
  const [v] = await sql<{ id: string }[]>`SELECT id FROM product_variant WHERE sku = 'PR1-A'`;
  await sql`INSERT INTO price_list_item (tenant_id,price_list_id,variant_id,price) VALUES (${T},${pl.id},${v.id},7500000)`;

  const row = (await list()).find((p) => p.code === "PR1")!;
  assert.equal(row.basePrice, 7_500_000, "عدد، نه رشته‌ی bigint");
  assert.equal(typeof row.basePrice, "number");
});

test("🔴 صفحه‌بندی: limit/offset/hasMore درست‌اند، q روی نام/کد/رنگ فیلتر می‌کند", async () => {
  for (const code of ["Z1", "Z2", "Z3"])
    await createProduct(T, { name: `کاشیِ ${code}`, code, sku: `${code}-A`, color: code === "Z2" ? "طلایی" : null });

  const page1 = await listProducts({ tenantId: T, limit: 2 });
  assert.equal(page1.items.length, 2, "limit را رعایت می‌کند");
  assert.equal(page1.hasMore, true, "ردیفِ سوم هست ولی در این صفحه نیامده");

  const page2 = await listProducts({ tenantId: T, limit: 2, offset: 2 });
  assert.equal(page2.items.length, 1);
  assert.equal(page2.hasMore, false, "آخرین صفحه");
  assert.notEqual(page1.items[0].code, page2.items[0].code, "صفحه‌ی دوم تکرارِ اول نیست");

  const byCode = await listProducts({ tenantId: T, q: "Z2" });
  assert.deepEqual(byCode.items.map((p) => p.code), ["Z2"], "جستجو با کد کار می‌کند");

  const byColor = await listProducts({ tenantId: T, q: "طلایی" });
  assert.deepEqual(byColor.items.map((p) => p.code), ["Z2"], "جستجو با رنگ هم کار می‌کند");
});
