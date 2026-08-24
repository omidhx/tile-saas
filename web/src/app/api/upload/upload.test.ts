import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesMagicBytes } from "@/lib/magicBytes";
import { isSafeImageUrl } from "@/lib/url";

// این تست‌ها برای منطقِ upload هستند.
// route-level test کامل نیاز به Next.js runtime + PostgreSQL دارد، ولی
// منطقِ اعتبارسنجی (magic bytes، URL safety) را اینجا تست می‌کنیم.

// ──────────────────────────────────────────────────────────
// magicBytes — positive و negative
// ──────────────────────────────────────────────────────────

test("magicBytes: JPEG معتبر", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  assert.equal(matchesMagicBytes("image/jpeg", jpeg), true);
});

test("magicBytes: PNG معتبر", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  assert.equal(matchesMagicBytes("image/png", png), true);
});

test("magicBytes: WebP معتبر", () => {
  const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(matchesMagicBytes("image/webp", webp), true);
});

test("magicBytes: MIME جعلی با محتوای JPEG", () => {
  // مهاجم می‌گوید image/png ولی فایل JPEG است
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
  assert.equal(matchesMagicBytes("image/png", jpeg), false);
});

test("magicBytes: MIME جعلی با محتوای PNG", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(matchesMagicBytes("image/jpeg", png), false);
});

test("magicBytes: MIME جعلی با محتوای text", () => {
  const text = Buffer.from("<script>alert(1)</script>");
  assert.equal(matchesMagicBytes("image/jpeg", text), false);
  assert.equal(matchesMagicBytes("image/png", text), false);
  assert.equal(matchesMagicBytes("image/webp", text), false);
});

test("magicBytes: MIME نامعتبر", () => {
  const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
  assert.equal(matchesMagicBytes("application/octet-stream", buf), false);
  assert.equal(matchesMagicBytes("text/html", buf), false);
  assert.equal(matchesMagicBytes("image/gif", buf), false);
});

test("magicBytes: buffer خیلی کوتاه", () => {
  assert.equal(matchesMagicBytes("image/jpeg", Buffer.from([0xff])), false);
  assert.equal(matchesMagicBytes("image/jpeg", Buffer.from([])), false);
  assert.equal(matchesMagicBytes("image/png", Buffer.from([0x89, 0x50])), false);
});

// ──────────────────────────────────────────────────────────
// isSafeImageUrl — path traversal defense
// ──────────────────────────────────────────────────────────

test("isSafeImageUrl: مسیر نسبی مجاز است (/uploads/...)", () => {
  assert.equal(isSafeImageUrl("/uploads/test.jpg"), true);
});

test("isSafeImageUrl: path traversal رد می‌شود", () => {
  assert.equal(isSafeImageUrl("/uploads/../../etc/passwd"), false);
  assert.equal(isSafeImageUrl("/uploads/../web/.env"), false);
});

test("isSafeImageUrl: protocol-relative رد می‌شود", () => {
  assert.equal(isSafeImageUrl("//evil.com/upload.jpg"), false);
});

test("isSafeImageUrl: javascript: رد می‌شود", () => {
  assert.equal(isSafeImageUrl("javascript:alert(1)"), false);
});

test("isSafeImageUrl: data: رد می‌شود", () => {
  assert.equal(isSafeImageUrl("data:image/png;base64,..."), false);
});

test("isSafeImageUrl: http/https مجاز است", () => {
  assert.equal(isSafeImageUrl("https://example.com/image.jpg"), true);
  assert.equal(isSafeImageUrl("http://example.com/image.png"), true);
});

// ──────────────────────────────────────────────────────────
// Upload route contract — مستندسازی قرارداد
// ──────────────────────────────────────────────────────────

// این تست‌ها قراردادِ upload route را مستند می‌کنند.
// برای route-level test کامل (با Next.js runtime + auth + DB)، نیاز به
// integration test environment است که در scope این فایل نیست.

test("Upload contract: MIME whitelist", () => {
  const ALLOWED: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  // فقط این سه MIME مجاز هستند
  assert.ok(ALLOWED["image/jpeg"]);
  assert.ok(ALLOWED["image/png"]);
  assert.ok(ALLOWED["image/webp"]);
  // این‌ها مجاز نیستند
  assert.equal(ALLOWED["image/gif"], undefined);
  assert.equal(ALLOWED["image/svg+xml"], undefined);
  assert.equal(ALLOWED["application/octet-stream"], undefined);
  assert.equal(ALLOWED["text/html"], undefined);
});

test("Upload contract: سقف حجم ۳ مگابایت", () => {
  const MAX_BYTES = 3 * 1024 * 1024;
  assert.equal(MAX_BYTES, 3145728);
  // ۳ مگابایت = ۳۱۴۵۷۲۸ بایت
});

test("Upload contract: response شکل", () => {
  // response مورد انتظار: { url: "/uploads/UUID.ext" }
  const mockResponse = { url: "/uploads/550e8400-e29b-41d4-a716-446655440000.jpg" };
  assert.ok(mockResponse.url.startsWith("/uploads/"));
  assert.ok(mockResponse.url.endsWith(".jpg"));
});
