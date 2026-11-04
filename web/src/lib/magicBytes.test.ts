import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesMagicBytes } from "./magicBytes";

test("امضای واقعیِ هر فرمت پذیرفته می‌شود", () => {
  assert.equal(matchesMagicBytes("image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])), true);
  assert.equal(matchesMagicBytes("image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])), true);
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP")]);
  assert.equal(matchesMagicBytes("image/webp", webp), true);
});

test("🔴 File.type جعلی با محتوای واقعیِ متفاوت رد می‌شود", () => {
  // یک فایلِ متنی که client اسمش را image/jpeg گذاشته
  const fakeText = Buffer.from("<script>alert(1)</script>");
  assert.equal(matchesMagicBytes("image/jpeg", fakeText), false);
  assert.equal(matchesMagicBytes("image/png", fakeText), false);
  assert.equal(matchesMagicBytes("image/webp", fakeText), false);
});

test("mimeِ ناشناخته همیشه رد می‌شود", () => {
  assert.equal(matchesMagicBytes("application/octet-stream", Buffer.from([0xff, 0xd8, 0xff])), false);
});
