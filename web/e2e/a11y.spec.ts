import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { AGENT, STAFF, login } from "./helpers";

/**
 * دسترس‌پذیری نسبت به baseline: UI در فاز ۶ تا ۸ عوض می‌شود، پس بدهی فعلی ثبت شده و این‌جا اصلاح
 * نمی‌شود، ولی تعداد خطا در هیچ قاعده‌ای نباید از baseline بیشتر شود. برای ثبت دوباره:
 * A11Y_UPDATE=1 npx playwright test a11y
 */
const BASELINE_PATH = join(__dirname, "a11y-baseline.json");
type Counts = Record<string, Record<string, number>>;
const baseline: Counts = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const measured: Counts = {};

async function scan(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).analyze();
  measured[path] = Object.fromEntries(violations.map((v) => [v.id, v.nodes.length]));
}

/** فقط قواعدی که از baseline بدتر شده‌اند. */
function regressions(paths: string[]) {
  return paths.flatMap((path) =>
    Object.entries(measured[path]!)
      .filter(([rule, count]) => count > (baseline[path]?.[rule] ?? 0))
      .map(([rule, count]) => `${path} ${rule}: ${count} (baseline ${baseline[path]?.[rule] ?? 0})`));
}

test.afterAll(() => {
  if (process.env.A11Y_UPDATE) writeFileSync(BASELINE_PATH, JSON.stringify({ ...baseline, ...measured }, null, 2) + "\n");
});

const PUBLIC_PAGES = ["/login", "/reset"];
const AGENT_PAGES = ["/reserve", "/reservations"];
const STAFF_PAGES = ["/staff", "/staff/catalog", "/staff/customers", "/staff/reports"];

test("a11y: صفحه‌های عمومی", async ({ page }) => {
  for (const path of PUBLIC_PAGES) await scan(page, path);
  if (!process.env.A11Y_UPDATE) expect(regressions(PUBLIC_PAGES)).toEqual([]);
});

test("a11y: صفحه‌های نماینده", async ({ page }) => {
  await login(page, AGENT);
  for (const path of AGENT_PAGES) await scan(page, path);
  if (!process.env.A11Y_UPDATE) expect(regressions(AGENT_PAGES)).toEqual([]);
});

test("a11y: صفحه‌های پشتیبان", async ({ page }) => {
  await login(page, STAFF);
  for (const path of STAFF_PAGES) await scan(page, path);
  if (!process.env.A11Y_UPDATE) expect(regressions(STAFF_PAGES)).toEqual([]);
});
