import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { STAFF, login } from "./helpers";

/**
 * عددهای قبل و بعد بازطراحی (فاز ۶ و ۷): ارتفاع صفحه، فاصله‌ی اسکرول تا دکمه‌ی هر کار اصلی،
 * تعداد کنترل‌های صفحه و تعداد قاب‌های تودرتو دور هر دکمه. در CI اجرا نمی‌شود:
 * UX_METRICS=<پوشه> npx playwright test ux-metrics
 */
const OUT = process.env.UX_METRICS;
test.skip(!OUT, "فقط با UX_METRICS");

/** دکمه‌ی اول هر کار اصلی؛ اسم دکمه در UI قدیم و جدید یکی است. */
const TASKS = { approve: "تأیید", dispatch: "ساخت حواله", ready: "آماده بارگیری" };

for (const width of [375, 1440]) {
  test(`ux-metrics ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await login(page, STAFF);
    await page.goto("/staff");
    await page.waitForLoadState("networkidle");
    const metrics = await page.evaluate((tasks) => {
      const boxed = (el: Element) => {
        const s = getComputedStyle(el);
        return parseFloat(s.borderTopWidth) > 0 || s.boxShadow !== "none";
      };
      const visible = (el: Element) => (el as HTMLElement).offsetParent !== null;
      const controls = [...document.querySelectorAll("main button, main input, main select, main a[href]")].filter(visible);
      const out: Record<string, unknown> = {
        pageHeight: document.documentElement.scrollHeight,
        controls: controls.length,
      };
      for (const [key, name] of Object.entries(tasks)) {
        const btn = [...document.querySelectorAll("main button")]
          .find((b) => visible(b) && b.textContent?.trim() === name);
        if (!btn) { out[key] = null; continue; }
        let depth = 0;
        for (let el = btn.parentElement; el && el.tagName !== "MAIN"; el = el.parentElement) if (boxed(el)) depth++;
        out[key] = { y: Math.round(btn.getBoundingClientRect().top + scrollY), boxedAncestors: depth };
      }
      return out;
    }, TASKS);
    mkdirSync(OUT!, { recursive: true });
    writeFileSync(join(OUT!, `staff-${width}.json`), JSON.stringify(metrics, null, 2));
    await page.screenshot({ path: join(OUT!, `staff-${width}.png`), fullPage: true });
  });
}
