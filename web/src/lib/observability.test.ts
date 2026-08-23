import { test } from "node:test";
import assert from "node:assert/strict";
import { logger, getRequestId } from "./logger";
import { metrics } from "./metrics";

// ──────────────────────────────────────────────
// Logger tests
// ──────────────────────────────────────────────

test("logger: info produces valid JSON with required fields", () => {
  // capture console.log
  const original = console.log;
  let captured = "";
  console.log = (msg: string) => { captured = msg; };

  logger.info("test message", { requestId: "req-123", route: "/api/test" });

  console.log = original;

  const parsed = JSON.parse(captured);
  assert.equal(parsed.level, "info");
  assert.equal(parsed.message, "test message");
  assert.equal(parsed.service, "web");
  assert.equal(parsed.requestId, "req-123");
  assert.equal(parsed.route, "/api/test");
  assert.ok(parsed.timestamp, "timestamp should be present");
});

test("logger: redaction of sensitive fields", () => {
  const original = console.log;
  let captured = "";
  console.log = (msg: string) => { captured = msg; };

  logger.info("test", { password: "secret123", token: "jwt-token", apiKey: "key-456" });

  console.log = original;

  const parsed = JSON.parse(captured);
  assert.equal(parsed.password, "[REDACTED]");
  assert.equal(parsed.token, "[REDACTED]");
  assert.equal(parsed.apiKey, "[REDACTED]");
});

test("logger: redaction of nested sensitive fields", () => {
  const original = console.log;
  let captured = "";
  console.log = (msg: string) => { captured = msg; };

  logger.info("test", { user: { name: "Ali", password: "secret" } });

  console.log = original;

  const parsed = JSON.parse(captured);
  assert.equal(parsed.user.name, "Ali");
  assert.equal(parsed.user.password, "[REDACTED]");
});

test("logger: debug suppressed in production", () => {
  const original = console.debug;
  let called = false;
  console.debug = () => { called = true; };

  const originalEnv = process.env.NODE_ENV;
  // @ts-expect-error — NODE_ENV is read-only in types but assignable at runtime
  process.env.NODE_ENV = "production";
  logger.debug("should not log");
  // @ts-expect-error — restore
  process.env.NODE_ENV = originalEnv;

  console.debug = original;
  assert.equal(called, false, "debug should be suppressed in production");
});

test("logger: error always logs", () => {
  const original = console.error;
  let captured = "";
  console.error = (msg: string) => { captured = msg; };

  logger.error("critical error", { errorCode: "DB_FAIL" });

  console.error = original;

  const parsed = JSON.parse(captured);
  assert.equal(parsed.level, "error");
  assert.equal(parsed.errorCode, "DB_FAIL");
});

// ──────────────────────────────────────────────
// RequestId tests
// ──────────────────────────────────────────────

test("getRequestId: uses existing x-request-id header", () => {
  const headers = new Headers();
  headers.set("x-request-id", "existing-id-123");
  assert.equal(getRequestId(headers), "existing-id-123");
});

test("getRequestId: generates new UUID if header missing", () => {
  const headers = new Headers();
  const id = getRequestId(headers);
  assert.ok(id.length > 10, "should generate a UUID");
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

// ──────────────────────────────────────────────
// Metrics tests
// ──────────────────────────────────────────────

test("metrics: recordRequest and toJSON", () => {
  metrics.reset();
  metrics.recordRequest("/api/test", "GET", 200, 50);
  metrics.recordRequest("/api/test", "GET", 200, 100);
  metrics.recordRequest("/api/test", "POST", 400, 30);

  const json = metrics.toJSON();
  assert.equal(json.total_requests, 3);
  assert.equal(json.count_4xx, 1);
  assert.equal(json.count_5xx, 0);
  assert.ok((json.routes as Record<string, unknown>)["GET /api/test"]);
  assert.ok((json.routes as Record<string, unknown>)["POST /api/test"]);
});

test("metrics: error rate calculation", () => {
  metrics.reset();
  metrics.recordRequest("/api/test", "GET", 200, 50);
  metrics.recordRequest("/api/test", "GET", 500, 50);
  metrics.recordRequest("/api/test", "GET", 500, 50);

  const json = metrics.toJSON();
  assert.equal(json.total_requests, 3);
  assert.equal(json.count_5xx, 2);
  assert.ok((json.error_rate as string).includes("66.67"), `expected ~66.67%, got ${json.error_rate}`);
});

test("metrics: latency tracking", () => {
  metrics.reset();
  metrics.recordRequest("/api/test", "GET", 200, 10);
  metrics.recordRequest("/api/test", "GET", 200, 20);
  metrics.recordRequest("/api/test", "GET", 200, 30);

  const json = metrics.toJSON();
  const route = (json.routes as Record<string, { count?: number; avgMs: number; minMs: number; maxMs: number }>)["GET /api/test"];
  assert.equal(route.count, 3);
  assert.equal(route.minMs, 10);
  assert.equal(route.maxMs, 30);
  assert.equal(route.avgMs, 20);
});
