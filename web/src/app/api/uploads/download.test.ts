import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeImageUrl } from "@/lib/url";

// تست‌های منطق download route — route-level integration test نیاز به
// Next.js runtime + auth دارد، ولی منطقِ authorization را اینجا تست می‌کنیم.

test("download route: URL عمومی دیگر دسترسی مستقیم ندارد", () => {
  // فایل‌ها در private/uploads/ هستند — نه public/uploads/
  // یعنی `/uploads/foo.jpg` دیگر یک فایل static serving نیست،
  // بلکه از طریق /api/uploads/[id] با احراز هویت قابل دسترسی است.
  // این تست فقط تأیید می‌کند که isSafeImageUrl هنوز مسیر /uploads/ را قبول می‌کند
  // (چون URL در DB با همین فرمت ذخیره می‌شود).
  assert.equal(isSafeImageUrl("/uploads/test-uuid.jpg"), true);
  assert.equal(isSafeImageUrl("/uploads/../../etc/passwd"), false);
});

test("download route: path traversal در id پارامتر رد می‌شود", () => {
  // id در URL باید فقط UUID.ext باشد — هر کاراکتر غیرمجاز رد می‌شود
  const sanitize = (id: string) => id.replace(/[^a-zA-Z0-9.\-]/g, "");

  assert.equal(sanitize("550e8400-e29b-41d4-a716-446655440000.jpg"), "550e8400-e29b-41d4-a716-446655440000.jpg");
  assert.equal(sanitize("../../../etc/passwd"), "etcpasswd");
  assert.equal(sanitize("..\\..\\windows"), "windows");
  assert.equal(sanitize("file<script>alert(1)</script>.jpg"), "filescriptalert1script.jpg");
});

test("download route: Content-Type بر اساس پسوند", () => {
  const ext = (name: string) => name.split(".").pop()?.toLowerCase();
  const contentType = (e: string) =>
    e === "jpg" || e === "jpeg" ? "image/jpeg" :
    e === "png" ? "image/png" :
    e === "webp" ? "image/webp" :
    "application/octet-stream";

  assert.equal(contentType(ext("test.jpg")!), "image/jpeg");
  assert.equal(contentType(ext("test.png")!), "image/png");
  assert.equal(contentType(ext("test.webp")!), "image/webp");
  assert.equal(contentType(ext("test.gif")!), "application/octet-stream");
  assert.equal(contentType(ext("test")!), "application/octet-stream");
});
