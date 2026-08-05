import { defineConfig, devices } from "@playwright/test";

/**
 * e2e برای مسیرهای حیاتی — ورود/نقش‌ها، رزرو→تأیید→حواله→بارگیری. برخلافِ
 * تست‌های واحد (که هر فایل schema را خودش resetSchema می‌کند)، این‌ها روی یک
 * سرورِ واقعی و یک DBِ مشترک اجرا می‌شوند؛ globalSetup قبل از هرچیز DBِ dev را
 * با seed:dev بازمی‌سازد تا وضعیتِ شروع همیشه شناخته‌شده باشد.
 *
 * fullyParallel عمداً خاموش است: مسیرِ رزرو→تأیید→حواله وضعیتِ مشترک (صفِ
 * پشتیبان) را می‌خواند/می‌نویسد؛ اجرای موازیِ چند تست همین فایل با هم رقابت می‌کرد.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
