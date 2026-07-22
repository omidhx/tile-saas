import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { createProduct, listProducts, updateProduct, setProductImage } from "./products";

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

test("تنظیم و حذفِ عکس", async () => {
  const r = await createProduct(T, { name: "P", code: "P1", sku: "P1-A" });
  assert.ok(r.ok);
  await setProductImage({ tenantId: T, productId: r.id, imageUrl: "https://cdn/x.jpg" });
  assert.equal((await listProducts(T))[0].imageUrl, "https://cdn/x.jpg");
  await setProductImage({ tenantId: T, productId: r.id, imageUrl: null });
  assert.equal((await listProducts(T))[0].imageUrl, null);
});
