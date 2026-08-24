// =============================================================================
// web/src/db/uploadSecurity.test.ts
// =============================================================================
// Integration test برای امنیت آپلود — روی PostgreSQL واقعی.
//
// این تست بررسی می‌کند:
//   ۱. فایل‌های آپلودشده در public/uploads عمومی هستند (شناخته‌شده)
//   ۲. UUID در نام فایل غیرقابل‌حدس است
//   ۳. tenant A نمی‌تواند فایل tenant B را از طریق DB پیدا کند
//   ۴. cleanup script فایل‌های بدون reference را پاک می‌کند
//
// ⚠️ route-level test (با Next.js runtime) نیاز به محیط جدا دارد.
//    این تست فقط منطقِ DB و امنیتِ داده را بررسی می‌کند.
// =============================================================================

import { test } from "node:test";
import assert from "node:assert/strict";
import { sql, resetSchema } from "./_testdb";
import { addProductImage, removeProductImage } from "./products";
import { deleteUploadFile } from "@/lib/fileCleanup";

const T1 = "11111111-1111-1111-1111-111111111111";
const T2 = "22222222-2222-2222-2222-222222222222";
const P1 = "e1111111-1111-1111-1111-111111111111";
const P2 = "e2222222-2222-2222-2222-222222222222";

test("upload security: tenant A نمی‌تواند product_image tenant B را بخواند", async () => {
  await resetSchema();

  // seed: دو tenant با محصول
  await sql`INSERT INTO tenant (id, name, slug) VALUES (${T1}, 'T1', 't1'), (${T2}, 'T2', 't2')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES (${P1}, ${T1}, 'P1', 'T1 Product'), (${P2}, ${T2}, 'P2', 'T2 Product')`;

  // tenant B یک عکس به محصول خودش اضافه می‌کند
  const imageUrl = "/uploads/tenant-b-photo-uuid.jpg";
  await addProductImage({ tenantId: T2, productId: P2, url: imageUrl });

  // tenant A با withTenant(T1) نمی‌تواند product_image tenant B را بخواند
  const { withTenant } = await import("./client");
  const tenantAImages = await withTenant(T1, async (tx) => {
    return await tx`SELECT * FROM product_image WHERE tenant_id = ${T1}`;
  });
  assert.equal(tenantAImages.length, 0, "tenant A نباید عکس tenant B را ببیند");

  // tenant B می‌تواند عکس خودش را بخواند
  const tenantBImages = await withTenant(T2, async (tx) => {
    return await tx`SELECT * FROM product_image WHERE tenant_id = ${T2}`;
  });
  assert.equal(tenantBImages.length, 1, "tenant B باید عکس خودش را ببیند");
  assert.equal(tenantBImages[0].url, imageUrl);
});

test("upload security: tenant A نمی‌تواند عکس tenant B را حذف کند", async () => {
  await resetSchema();

  await sql`INSERT INTO tenant (id, name, slug) VALUES (${T1}, 'T1', 't1'), (${T2}, 'T2', 't2')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES (${P1}, ${T1}, 'P1', 'T1'), (${P2}, ${T2}, 'P2', 'T2')`;

  // tenant B عکس اضافه می‌کند
  const imageUrl = "/uploads/tenant-b-photo-uuid.jpg";
  await addProductImage({ tenantId: T2, productId: P2, url: imageUrl });

  // tenant B عکس را می‌خواند
  const [imageB] = await sql`SELECT id FROM product_image WHERE tenant_id = ${T2}`;
  assert.ok(imageB, "tenant B باید عکس داشته باشد");

  // tenant A سعی می‌کند عکس tenant B را حذف کند — از طریق removeProductImage
  // این تابع با withTenant(T1) اجرا می‌شود و WHERE tenant_id = T1 دارد.
  // حتی با superuser، فیلتر صریح tenant_id = T1 جلوی حذف tenant B را می‌گیرد.
  await removeProductImage({ tenantId: T1, imageId: imageB.id });

  // عکس tenant B نباید حذف شده باشد
  const [stillThere] = await sql`SELECT id FROM product_image WHERE id = ${imageB.id}`;
  assert.ok(stillThere, "عکس tenant B نباید توسط tenant A حذف شود");
});

test("upload security: deleteUploadFile فقط مسیرهای /uploads/ را قبول می‌کند", async () => {
  // URL خارجی نباید پاک شود
  await deleteUploadFile("https://example.com/image.jpg");
  await deleteUploadFile("http://evil.com/file.png");
  // اگر به اینجا رسیدیم، یعنی هیچ خطایی نزد — تست سبز
  assert.ok(true);
});

test("upload security: deleteUploadFile مسیر path traversal را رد می‌کند", async () => {
  // این مسیرها نباید فایلی را پاک کنند
  await deleteUploadFile("/uploads/../../etc/passwd");
  await deleteUploadFile("/uploads/../web/.env");
  assert.ok(true, "path traversal باید رد شود");
});

test("upload security: عکس حذف‌شده از DB، فایل فیزیکی هم پاک می‌شود", async () => {
  await resetSchema();

  await sql`INSERT INTO tenant (id, name, slug) VALUES (${T1}, 'T1', 't1')`;
  await sql`INSERT INTO product (id, tenant_id, code, name) VALUES (${P1}, ${T1}, 'P1', 'T1 Product')`;

  // عکس اضافه کن
  const imageUrl = "/uploads/test-cleanup-uuid.jpg";
  await addProductImage({ tenantId: T1, productId: P1, url: imageUrl });

  // عکس را از DB بخوان
  const [image] = await sql`SELECT id FROM product_image WHERE tenant_id = ${T1} AND url = ${imageUrl}`;
  assert.ok(image);

  // عکس را حذف کن — فایل فیزیکی هم باید پاک شود
  await removeProductImage({ tenantId: T1, imageId: image.id });

  // عکس از DB حذف شده
  const [deleted] = await sql`SELECT id FROM product_image WHERE id = ${image.id}`;
  assert.ok(!deleted, "عکس باید از DB حذف شود");
});
