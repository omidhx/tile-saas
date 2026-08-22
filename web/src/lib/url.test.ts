import { test } from "node:test";
import assert from "node:assert/strict";
import { isSafeImageUrl } from "./url";

test("isSafeImageUrl: http/https مجازند", () => {
  assert.equal(isSafeImageUrl("https://cdn.example.com/a.jpg"), true);
  assert.equal(isSafeImageUrl("http://example.com/a.jpg"), true);
});

test("isSafeImageUrl: مسیرِ نسبیِ خودِ سایت (خروجیِ /api/upload) مجاز است", () => {
  assert.equal(isSafeImageUrl("/uploads/abc123.jpg"), true);
});

test("isSafeImageUrl: اسکیم‌های خطرناک رد می‌شوند", () => {
  assert.equal(isSafeImageUrl("javascript:alert(1)"), false);
  assert.equal(isSafeImageUrl("data:text/html,<script>alert(1)</script>"), false);
  assert.equal(isSafeImageUrl("vbscript:msgbox(1)"), false);
  assert.equal(isSafeImageUrl("file:///etc/passwd"), false);
});

test("isSafeImageUrl: protocol-relative (//host) رد می‌شود", () => {
  assert.equal(isSafeImageUrl("//evil.com/a.jpg"), false);
});

test("isSafeImageUrl: رشته‌ی نامعتبر رد می‌شود", () => {
  assert.equal(isSafeImageUrl("not a url"), false);
  assert.equal(isSafeImageUrl(""), false);
});
