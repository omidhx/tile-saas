import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetRates } from "@/auth/rateLimit";

// این تست‌ها برای middleware CSRF هستند.
// middleware در Node.js test runner مستقیماً قابل صدا زدن نیست (چون NextRequest
// نیاز به Next.js runtime دارد)، ولی منطقِ CSRF را می‌توان با mock کردن
// بررسی کرد.

// منطقِ CSRF در middleware.ts:
// ۱. اگر method GET/HEAD/OPTIONS → مجاز (بدون CSRF check)
// ۲. اگر mutation:
//    a. Origin: null → 403
//    b. Origin ≠ Host → 403
//    c. Origin malformed → 400
//    d. Origin = Host → مجاز
//    e. Origin نبود → مجاز (نرم، SameSite=lax بقیه‌ی کار)
//    f. Host نبود → مجاز (نرم)

// این تابع منطقِ CSRF middleware را شبیه‌سازی می‌کند.
// اگر middleware.ts تغییر کرد، این تابع هم باید به‌روز شود.
function csrfCheck(method: string, origin: string | null, host: string | null): { status: number; error?: string } | null {
  const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(method.toUpperCase());
  if (!isMutation) return null; // مجاز

  if (host) {
    if (origin === "null") {
      return { status: 403, error: "null_origin_forbidden" };
    }
    if (origin) {
      try {
        const url = new URL(origin);
        if (url.host !== host) {
          return { status: 403, error: "cross_origin_forbidden" };
        }
      } catch {
        return { status: 400, error: "invalid_origin" };
      }
    }
    // Origin نبود → مجاز (نرم)
  }
  // Host نبود → مجاز (نرم)
  return null; // مجاز
}

beforeEach(() => resetRates());

test("CSRF: GET مجاز است (بدون CSRF check)", () => {
  const result = csrfCheck("GET", null, "example.com");
  assert.equal(result, null);
});

test("CSRF: HEAD مجاز است", () => {
  const result = csrfCheck("HEAD", null, "example.com");
  assert.equal(result, null);
});

test("CSRF: OPTIONS مجاز است", () => {
  const result = csrfCheck("OPTIONS", null, "example.com");
  assert.equal(result, null);
});

test("CSRF: POST same-origin مجاز است", () => {
  const result = csrfCheck("POST", "https://example.com", "example.com");
  assert.equal(result, null);
});

test("CSRF: POST cross-origin رد می‌شود (403)", () => {
  const result = csrfCheck("POST", "https://evil.com", "example.com");
  assert.deepEqual(result, { status: 403, error: "cross_origin_forbidden" });
});

test("CSRF: POST با Origin: null رد می‌شود (403)", () => {
  const result = csrfCheck("POST", "null", "example.com");
  assert.deepEqual(result, { status: 403, error: "null_origin_forbidden" });
});

test("CSRF: POST با Origin malformed رد می‌شود (400)", () => {
  const result = csrfCheck("POST", "not-a-url", "example.com");
  assert.deepEqual(result, { status: 400, error: "invalid_origin" });
});

test("CSRF: POST بدون Origin مجاز است (API client / مرورگر قدیمی)", () => {
  const result = csrfCheck("POST", null, "example.com");
  assert.equal(result, null);
});

test("CSRF: PATCH cross-origin رد می‌شود", () => {
  const result = csrfCheck("PATCH", "https://evil.com", "example.com");
  assert.deepEqual(result, { status: 403, error: "cross_origin_forbidden" });
});

test("CSRF: DELETE بدون Host مجاز است (نرم)", () => {
  const result = csrfCheck("DELETE", "https://example.com", null);
  assert.equal(result, null);
});

test("CSRF: POST با Origin و Host هم‌نام ولی scheme متفاوت مجاز است", () => {
  // http vs https — مهم Host است نه scheme
  const result = csrfCheck("POST", "http://example.com", "example.com");
  assert.equal(result, null);
});

test("CSRF: POST با Origin شامل port و Host بدون port", () => {
  // اگر Origin پورت دارد ولی Host ندارد → mismatch
  const result = csrfCheck("POST", "https://example.com:8080", "example.com");
  assert.deepEqual(result, { status: 403, error: "cross_origin_forbidden" });
});

test("CSRF: POST با Origin و Host هم‌نام با port مجاز است", () => {
  const result = csrfCheck("POST", "https://example.com:3000", "example.com:3000");
  assert.equal(result, null);
});
