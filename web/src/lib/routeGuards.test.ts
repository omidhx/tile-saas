import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * گاردِ ایستا روی routeها. تست‌های authz خودِ توابع را می‌سنجند، نه اینکه کدام route
 * از کدام استفاده می‌کند؛ پس عوض‌کردنِ adminCtx به staffCtx هیچ تستی را قرمز نمی‌کرد.
 */
const API = fileURLToPath(new URL("../app/api/", import.meta.url));

/** بدنه‌ی هر handler، به‌ترتیبِ ظاهرشدن در فایل. */
function handlers(route: string): { method: string; body: string }[] {
  const src = readFileSync(`${API}${route}/route.ts`, "utf8");
  const parts = src.split(/^export async function /m).slice(1);
  return parts.map((p) => ({ method: p.slice(0, p.indexOf("(")), body: p }));
}

test("فقط admin: نوشتنِ امکانات، تیم، و سقفِ تأیید خودکار", () => {
  const features = handlers("settings/features");
  assert.match(features.find((h) => h.method === "PUT")!.body, /adminCtx\(/);
  assert.match(features.find((h) => h.method === "GET")!.body, /staffCtx\(/);

  for (const h of handlers("team")) assert.match(h.body, /adminCtx\(/, `team ${h.method}`);
  for (const h of handlers("agent-overrides")) assert.match(h.body, /adminCtx\(/, `agent-overrides ${h.method}`);
  for (const h of handlers("settings/auto-approve")) assert.match(h.body, /authorizeAdmin\(/, `auto-approve ${h.method}`);
});

test("امکانِ خاموش در هر handler همان route بسته می‌شود، بعد از احراز", () => {
  const gated: Record<string, string> = {
    "volume-discounts": "volume_discount",
    "agent-overrides": "agent_price",
    "substitutes": "substitutes",
    "price-lists": "price_lists",
    "prices": "pricing",
    "prices/import": "price_import",
    "settings/auto-approve": "auto_approve",
  };
  for (const [route, key] of Object.entries(gated)) {
    for (const h of handlers(route)) {
      const gate = h.body.indexOf(`featureOff(`);
      assert.ok(gate >= 0 && h.body.includes(`"${key}"`), `${route} ${h.method}: گیتِ ${key} نیست`);
      const auth = h.body.search(/(staffCtx|adminCtx|authorizeStaff|authorizeAdmin)\(/);
      assert.ok(auth >= 0 && auth < gate, `${route} ${h.method}: گیت باید بعد از احراز باشد`);
    }
  }
  assert.match(handlers("alerts")[0].body, /\.substitutes \? suggestSubstitutes/, "/api/alerts جایگزین را بی‌گیت می‌دهد");
});
