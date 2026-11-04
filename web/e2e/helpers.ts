import type { Page } from "@playwright/test";

// دیتای seed:dev (prepare-db.ts) — همان دو حسابِ شناخته‌شده‌ی محیطِ dev.
export const STAFF = { phone: "09120000001", password: "pass1234" };
export const AGENT = { phone: "09120000000", password: "pass1234" };

export async function login(page: Page, creds: { phone: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("شماره موبایل یا ایمیل").fill(creds.phone);
  await page.getByLabel("رمز عبور").fill(creds.password);
  await page.getByRole("button", { name: "ورود" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}
