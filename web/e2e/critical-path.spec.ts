import { test, expect, type Page } from "@playwright/test";

// دیتای seed:dev (globalSetup) — همان دو حسابِ شناخته‌شده‌ی محیطِ dev.
const STAFF = { phone: "09120000001", password: "pass1234" };
const AGENT = { phone: "09120000000", password: "pass1234" };

async function login(page: Page, creds: { phone: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("شماره موبایل یا ایمیل").fill(creds.phone);
  await page.getByLabel("رمز عبور").fill(creds.password);
  await page.getByRole("button", { name: "ورود" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * مسیرِ حیاتی: نماینده رزرو می‌کند → (تأییدِ دستی یا خودکار) → پشتیبان حواله
 * می‌سازد → حواله را تا «بارگیری‌شده» پیش می‌برد. همان چیزی که Phase-3ِ audit
 * با تستِ دستی باگ‌های واقعی از دلش درآورد — این‌جا خودکار تکرار می‌شود.
 *
 * دو مسیرِ ممکن بعدِ ثبتِ رزرو (تأییدِ دستی/خودکار، بسته به سقفِ تننت و قیمتِ
 * کالا) هردو پوشش داده می‌شوند — قفل‌کردنِ تست به یکی از آن‌ها شکننده بود.
 */
test("ورود → رزرو → تأیید/خودکار → حواله → بارگیری", async ({ page }) => {
  // ۱. نماینده: افزودن به سبد + ثبتِ رزرو
  await login(page, AGENT);
  await page.goto("/reserve");

  const lotCard = page.locator(".card").filter({ has: page.getByPlaceholder("تعداد کارتن") }).first();
  await expect(lotCard).toBeVisible({ timeout: 15_000 });
  const productName = (await lotCard.locator("strong").first().innerText()).trim();

  // مقدارِ عمداً غیرمعمول (۷) تا با هیچ‌کدام از سفارش‌های دموی seed:dev (که همه
  // مقدارهای رندِ ۱۲۰/۶۰/۲۵/۳۰/۲۰/۱۴ دارند) تصادفاً هم‌نام+هم‌مقدار نشود —
  // بدونِ این، فیلترِ productName به‌تنهایی می‌توانست کارتِ دموی هم‌محصول را
  // به‌جای کارتِ خودمان بگیرد (دقیقاً همین اتفاق افتاد: «کاشی سفید مات» هم
  // محصولِ ما بود هم محصولِ سفارشِ ۳ِ دمو).
  const qtyMarker = "×۷";
  await lotCard.getByPlaceholder("تعداد کارتن").fill("7");
  await page.getByRole("button", { name: /ثبت رزرو/ }).click();

  const submitBanner = page.locator(".banner--ok").first();
  await expect(submitBanner).toBeVisible({ timeout: 15_000 });
  const autoApproved = (await submitBanner.innerText()).includes("تأیید شد");

  // ۲. پشتیبان: تأییدِ دستی (اگر لازم بود) + ساختِ حواله
  await login(page, STAFF);
  await page.goto("/staff");

  if (!autoApproved) {
    const pendingCard = page.getByTestId("pending-reservations").locator(".card").filter({ hasText: productName }).filter({ hasText: qtyMarker }).first();
    await expect(pendingCard).toBeVisible({ timeout: 15_000 });
    await pendingCard.getByRole("button", { name: "تأیید" }).click();
    await expect(pendingCard).not.toBeVisible({ timeout: 15_000 });
  }

  const approvedCard = page.getByTestId("approved-requests").locator(".card").filter({ hasText: productName }).filter({ hasText: qtyMarker }).first();
  await expect(approvedCard).toBeVisible({ timeout: 15_000 });
  await approvedCard.getByRole("button", { name: "ساخت حواله" }).click();
  await expect(approvedCard).not.toBeVisible({ timeout: 15_000 });

  // ۳. حواله: تا «بارگیری‌شده» پیش می‌رود — لیست با created_at DESC می‌آید،
  // پس حواله‌ی تازه‌ساخته‌شده همیشه اولین کارت است.
  const dispatchList = page.getByTestId("dispatch-list");
  const dispatchCard = dispatchList.locator(".card").first();
  await expect(dispatchCard).toBeVisible({ timeout: 15_000 });
  await expect(dispatchCard.getByText("ثبت‌شده")).toBeVisible();

  await dispatchCard.getByRole("button", { name: "آماده بارگیری" }).click();
  await expect(dispatchCard.getByText("آماده بارگیری")).toBeVisible({ timeout: 15_000 });

  await dispatchCard.getByRole("button", { name: "بارگیری‌شده" }).click();
  await expect(dispatchCard.getByText("بارگیری‌شده")).toBeVisible({ timeout: 15_000 });
});

test("ورود با رمزِ غلط رد می‌شود", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("شماره موبایل یا ایمیل").fill(STAFF.phone);
  await page.getByLabel("رمز عبور").fill("رمزِ-غلط");
  await page.getByRole("button", { name: "ورود" }).click();
  // getByRole("alert") به‌تنهایی routerِ Next را هم می‌گیرد (route-announcerِ
  // داخلی‌اش هم role="alert" دارد) — با id همان بنرِ خطای فرم مشخص می‌شود.
  await expect(page.locator("#login-err")).toContainText("اشتباه است");
  await expect(page).toHaveURL(/\/login/);
});

test("پشتیبان به /reserve می‌رود ولی نماینده نیست، نه صفحه‌ی سفید", async ({ page }) => {
  await login(page, STAFF);
  await page.goto("/reserve");
  await expect(page.getByText("این کاربر به نمایندگی‌ای وصل نیست")).toBeVisible();
});
