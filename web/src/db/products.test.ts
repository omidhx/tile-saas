import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { createProduct, listProducts, updateProduct, addProductImage, removeProductImage, setPrimaryImage } from "./products";

/**
 * مدیریت محصول. قاعده‌ای که مهم است: ساختِ محصول باید هم‌زمان یک variant بسازد،
 * وگرنه محصولِ بی‌واریانت هرگز قابلِ سفارش نمی‌شود (تله‌ای که فرمِ ساده پنهانش می‌کند).
 */

const T = "11111111-1111-1111-1111-111111111111";

before(async () => {
  await resetSchema();
  await sql.unsafe(`INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');`);
});
after(async () => { await sql.end(); });
beforeEach(async () => {
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
  const list = await listProducts(T);
  assert.equal(list.length, 1);
  assert.equal(list[0].sku, "K1-A");
  assert.equal(list[0].hasStock, false, "محصولِ تازه هنوز موجودی/lot ندارد");
});

test("ویرایشِ ویژگی‌ها، sku و کد را دست نمی‌زند", async () => {
  const r = await createProduct(T, { name: "قبلی", code: "E1", sku: "E1-A" });
  assert.ok(r.ok);
  await updateProduct({ tenantId: T, productId: r.id, name: "جدید", glaze: "ترانس" });
  const [p] = await sql<{ name: string; glaze: string; code: string }[]>`
    SELECT p.name, p.glaze, p.code FROM product p WHERE p.id = ${r.id}`;
  assert.equal(p.name, "جدید");
  assert.equal(p.glaze, "ترانس");
  assert.equal(p.code, "E1", "کد نباید عوض شود — کلیدِ تطبیق است");
});

test("گالری: افزودن چند عکس، عکسِ اصلی = تامنیل (image_url)، تعیینِ اصلی و حذف", async () => {
  const r = await createProduct(T, { name: "P", code: "P1", sku: "P1-A", imageUrl: "https://cdn/a.jpg" });
  assert.ok(r.ok);
  // عکسِ اولِ سازنده → گالری + کَشِ اصلی
  let p = (await listProducts(T))[0];
  assert.equal(p.imageUrl, "https://cdn/a.jpg", "image_url = عکسِ اصلی");
  assert.equal(p.images.length, 1);

  await addProductImage({ tenantId: T, productId: r.id, url: "https://cdn/b.jpg" });
  p = (await listProducts(T))[0];
  assert.equal(p.images.length, 2);
  assert.equal(p.imageUrl, "https://cdn/a.jpg", "اصلی هنوز a است");

  // b را اصلی کن → تامنیل عوض می‌شود
  const b = p.images.find((i) => i.url === "https://cdn/b.jpg")!;
  await setPrimaryImage({ tenantId: T, imageId: b.id });
  p = (await listProducts(T))[0];
  assert.equal(p.imageUrl, "https://cdn/b.jpg", "اصلی حالا b");
  assert.equal(p.images[0].url, "https://cdn/b.jpg", "اولِ گالری = اصلی");

  // حذفِ اصلی → عکسِ بعدی خودکار اصلی
  await removeProductImage({ tenantId: T, imageId: b.id });
  p = (await listProducts(T))[0];
  assert.equal(p.images.length, 1);
  assert.equal(p.imageUrl, "https://cdn/a.jpg", "بعدِ حذفِ اصلی، a اصلی شد");

  // افزودنِ تکراری بی‌اثر است (idempotent)
  await addProductImage({ tenantId: T, productId: r.id, url: "https://cdn/a.jpg" });
  assert.equal((await listProducts(T))[0].images.length, 1);

  // حذفِ آخری → بدونِ عکس
  await removeProductImage({ tenantId: T, imageId: (await listProducts(T))[0].images[0].id });
  p = (await listProducts(T))[0];
  assert.equal(p.images.length, 0);
  assert.equal(p.imageUrl, null, "گالریِ خالی → تامنیلِ null");
});

test("ویرایشِ فیلدهای اطلاعاتِ بیشتر (ابعاد/ضخامت/کاربری/توضیحات)", async () => {
  const r = await createProduct(T, { name: "P", code: "P2", sku: "P2-A", size: "۶۰×۶۰", description: "کاشیِ کف" });
  assert.ok(r.ok);
  let p = (await listProducts(T)).find((x) => x.code === "P2")!;
  assert.equal(p.size, "۶۰×۶۰");
  assert.equal(p.description, "کاشیِ کف");
  await updateProduct({ tenantId: T, productId: r.id, thickness: "۹ میلی‌متر", usageArea: "کف/دیوار", size: "" });
  p = (await listProducts(T)).find((x) => x.code === "P2")!;
  assert.equal(p.thickness, "۹ میلی‌متر");
  assert.equal(p.usageArea, "کف/دیوار");
  assert.equal(p.size, null, "رشته‌ی خالی → null");
  assert.equal(p.description, "کاشیِ کف", "توضیحات دست‌نخورده چون undefined بود");
});

test("basePrice از اولین لیستِ قیمت می‌آید (نمایشی، نه ویرایش)", async () => {
  const r = await createProduct(T, { name: "قیمت‌دار", code: "PR1", sku: "PR1-A" });
  assert.ok(r.ok);
  // بدونِ لیست قیمت، basePrice باید null باشد
  assert.equal((await listProducts(T)).find((p) => p.code === "PR1")!.basePrice, null);

  // یک لیست + قیمت
  const [pl] = await sql<{ id: string }[]>`INSERT INTO price_list (tenant_id,name) VALUES (${T},'پایه') RETURNING id`;
  const [v] = await sql<{ id: string }[]>`SELECT id FROM product_variant WHERE sku = 'PR1-A'`;
  await sql`INSERT INTO price_list_item (tenant_id,price_list_id,variant_id,price) VALUES (${T},${pl.id},${v.id},7500000)`;

  const row = (await listProducts(T)).find((p) => p.code === "PR1")!;
  assert.equal(row.basePrice, 7_500_000, "عدد، نه رشته‌ی bigint");
  assert.equal(typeof row.basePrice, "number");
});
