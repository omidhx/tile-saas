import { test, expect, request as newRequest, type APIRequestContext } from "@playwright/test";
import { STAFF } from "./helpers";

// سقفِ ورود ۵ بار در ۱۵ دقیقه برای هر شناسه است و specهای دیگر هم با STAFF وارد می‌شوند؛
// پس این فایل STAFF را یک بار وارد می‌کند و چرخشِ نشست را با مدیرِ پلتفرمِ seed می‌سنجد.
const PLATFORM = { phone: "09129999999", password: STAFF.password };
let staff: APIRequestContext;
test.beforeAll(async ({ baseURL }) => { staff = await loggedIn(baseURL!, STAFF); });
test.afterAll(async () => { await staff.dispose(); });

/**
 * فاز ۴: رفتارِ HTTP روی بیلدِ production. این‌ها فقط با سرورِ واقعی دیده می‌شوند،
 * چون تست‌های واحد routeها را import نمی‌کنند (کوکی و rewriteِ Next لازم است).
 */
const T = "11111111-1111-1111-1111-111111111111"; // seed-dev.sql
const MISSING = "99999999-9999-9999-9999-999999999999";

async function loggedIn(baseURL: string, who: { phone: string; password: string }): Promise<APIRequestContext> {
  const ctx = await newRequest.newContext({ baseURL });
  const r = await ctx.post("/api/auth/login", { data: { identifier: who.phone, password: who.password } });
  expect(r.status()).toBe(200);
  return ctx;
}

// هر endpoint تستِ جدا دارد تا قرمزیِ هر کدام جدا دیده شود
test("PATCH /api/team با عضوِ ناموجود و fullName: ۴۰۴، نه TypeError", async () => {
  const r = await staff.patch("/api/team", { data: { tenantId: T, membershipId: MISSING, fullName: "x" } });
  expect(r.status()).toBe(404);
});

test("POST /api/imports با scope.type ناشناخته: ۴۰۰، نه CHECKِ دیتابیس", async () => {
  const r = await staff.post("/api/imports", {
    data: { tenantId: T, idempotencyKey: "p4-bad-scope", scope: { type: "galaxy" }, rows: [] },
  });
  expect(r.status()).toBe(400);
});

test("POST /api/prices با لیستِ ناموجود: ۴۰۴، نه FK", async () => {
  const r = await staff.post("/api/prices", {
    data: { tenantId: T, priceListId: MISSING, variantId: MISSING, price: 1000 },
  });
  expect(r.status()).toBe(404);
});

test("uuidِ خراب در query: ۴۰۰، نه 22P02", async () => {
  expect((await staff.get("/api/ledger?tenantId=not-a-uuid")).status()).toBe(400);
  expect((await staff.get(`/api/ledger?tenantId=${T}&lotId=not-a-uuid`)).status()).toBe(400);
});

// PNG یک پیکسلی
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

test("عکسِ آپلودشده با همان URLِ ذخیره‌شده و بدون ورود دیده می‌شود", async ({ baseURL }) => {
  const up = await staff.post("/api/upload", {
    multipart: { tenantId: T, file: { name: "a.png", mimeType: "image/png", buffer: PNG } },
  });
  expect(up.status()).toBe(201);
  const { url } = await up.json();
  expect(url).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);

  // کاتالوگِ عمومی ورود ندارد؛ عکس هم نباید بخواهد
  const anon = await newRequest.newContext({ baseURL });
  const img = await anon.get(url);
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toBe("image/png");
  expect(Buffer.compare(await img.body(), PNG)).toBe(0);

  // نامِ ناامن هرگز به دیسک نمی‌رسد
  expect((await anon.get("/uploads/..%2F..%2F.env")).status()).toBe(404);
  expect((await anon.get("/uploads/nope.png")).status()).toBe(404);
  await anon.dispose();
});

test("ورودِ دوباره نشستِ قبلی را باطل می‌کند (چرخشِ نشست)", async ({ baseURL }) => {
  const first = await loggedIn(baseURL!, PLATFORM);
  expect((await first.get("/api/me")).status()).toBe(200);
  const second = await loggedIn(baseURL!, PLATFORM);
  expect((await second.get("/api/me")).status()).toBe(200);
  expect((await first.get("/api/me")).status()).toBe(401);
  await Promise.all([first.dispose(), second.dispose()]);
});
