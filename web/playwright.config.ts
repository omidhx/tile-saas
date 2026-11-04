import { defineConfig, devices } from "@playwright/test";

/**
 * e2e برای مسیرهای حیاتی روی بیلد production (`npm run build` قبلش لازم است)، با نقش محدود
 * app_user و روی DB جداگانه. کلاستر همان کلاستر تست است (web/.env.test). web/.env هرگز
 * خوانده نمی‌شود، چون e2e دیتابیسش را از نو می‌سازد.
 *
 * fullyParallel عمداً خاموش است: مسیرِ رزرو→تأیید→حواله وضعیتِ مشترک (صفِ
 * پشتیبان) را می‌خواند/می‌نویسد؛ اجرای موازیِ چند تست همین فایل با هم رقابت می‌کرد.
 */
const PORT = 3100;
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://app_user:test_app_pw@localhost:55434/tile_e2e_test";
const E2E_ADMIN_DATABASE_URL =
  process.env.E2E_ADMIN_DATABASE_URL ?? "postgres://postgres:test_admin_pw@localhost:55434/tile_e2e_test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `node --import tsx e2e/prepare-db.mts && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/ready`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    env: {
      DATABASE_URL,
      E2E_ADMIN_DATABASE_URL,
      AUTH_SECRET: "0".repeat(32) + "_e2e_only",
      SENTRY_DSN: "",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
