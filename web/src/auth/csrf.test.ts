import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { assertSameOrigin } from "./csrf";
import { proxy } from "@/proxy";

// دو چک مستقل CSRF: proxy روی همه‌ی mutationها و assertSameOrigin در routeهای حساس auth.
// جدول هر دو یکسان است مگر جایی که رفتارشان عمداً فرق دارد (Origin: null).

function req(method: string, headers: Record<string, string>) {
  return new NextRequest("http://example.com/api/x", { method, headers });
}

/** وضعیتی که هر چک برمی‌گرداند؛ null یعنی درخواست عبور کرد. */
const viaProxy = (method: string, headers: Record<string, string>) => {
  const res = proxy(req(method, headers));
  return res.headers.get("x-middleware-next") ? null : res.status;
};
const viaHelper = (method: string, headers: Record<string, string>) =>
  assertSameOrigin(req(method, headers))?.status ?? null;

const HOST = "example.com";
const cases: [name: string, method: string, headers: Record<string, string>, expected: number | null][] = [
  ["GET بدون بررسی", "GET", { host: HOST, origin: "https://evil.com" }, null],
  ["HEAD بدون بررسی", "HEAD", { host: HOST, origin: "https://evil.com" }, null],
  ["OPTIONS بدون بررسی", "OPTIONS", { host: HOST, origin: "https://evil.com" }, null],
  ["POST هم‌مبدأ", "POST", { host: HOST, origin: "https://example.com" }, null],
  ["POST هم‌نام با scheme متفاوت", "POST", { host: HOST, origin: "http://example.com" }, null],
  ["POST بدون Origin (API client)", "POST", { host: HOST }, null],
  ["POST با port یکسان", "POST", { host: "example.com:3000", origin: "http://example.com:3000" }, null],
  ["POST بین‌مبدأ", "POST", { host: HOST, origin: "https://evil.com" }, 403],
  ["POST با port متفاوت", "POST", { host: HOST, origin: "https://example.com:8443" }, 403],
  ["POST با subdomain مهاجم", "POST", { host: HOST, origin: "https://evil.example.com" }, 403],
  ["PATCH بین‌مبدأ", "PATCH", { host: HOST, origin: "https://evil.com" }, 403],
  ["PUT بین‌مبدأ", "PUT", { host: HOST, origin: "https://evil.com" }, 403],
  ["DELETE بین‌مبدأ", "DELETE", { host: HOST, origin: "https://evil.com" }, 403],
  ["POST با Origin خراب", "POST", { host: HOST, origin: "not a url" }, 400],
];

for (const [name, method, headers, expected] of cases) {
  test(`proxy CSRF: ${name}`, () => assert.equal(viaProxy(method, headers), expected));
  test(`assertSameOrigin: ${name}`, () => assert.equal(viaHelper(method, headers), expected));
}

test("proxy CSRF: Origin برابر null رد می‌شود", () => {
  assert.equal(viaProxy("POST", { host: HOST, origin: "null" }), 403);
});

test("assertSameOrigin: Origin برابر null به‌عنوان Origin خراب رد می‌شود", () => {
  assert.equal(viaHelper("POST", { host: HOST, origin: "null" }), 400);
});
