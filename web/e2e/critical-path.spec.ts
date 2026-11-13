import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { AGENT, STAFF, login } from "./helpers";

/**
 * مسیرِ حیاتی: نماینده رزرو می‌کند → (تأییدِ دستی یا خودکار) → پشتیبان حواله
 * می‌سازد → حواله را تا «بارگیری‌شده» پیش می‌برد. همان چیزی که Phase-3ِ audit
 * با تستِ دستی باگ‌های واقعی از دلش درآورد — این‌جا خودکار تکرار می‌شود.
 *
 * دو مسیرِ ممکن بعدِ ثبتِ رزرو (تأییدِ دستی/خودکار، بسته به سقفِ تننت و قیمتِ
 * کالا) هردو پوشش داده می‌شوند — قفل‌کردنِ تست به یکی از آن‌ها شکننده بود.
 */
test("ورود → رزرو → تأیید/خودکار → حواله → بارگیری", async ({ page }) => {
  // oracle مستقل از UI: اگر سرور بارگیری را رد کند، موجودی کم نمی‌شود و تست باید قرمز شود.
  const admin = postgres(process.env.E2E_ADMIN_DATABASE_URL!, { max: 1 });
  const totalOnHand = async () => {
    const [{ total }] = await admin<{ total: number }[]>`SELECT SUM(on_hand_qty_boxes)::int AS total FROM inventory_balance`;
    return total;
  };
  const onHandBefore = await totalOnHand();

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

  // کارتابل (فاز ۶): هر مرحله یک گروه با testid است و هر ردیف [data-row].
  if (!autoApproved) {
    const pendingRow = page.getByTestId("pending-reservations").locator("[data-row]").filter({ hasText: productName }).filter({ hasText: qtyMarker }).first();
    await expect(pendingRow).toBeVisible({ timeout: 15_000 });
    await pendingRow.getByRole("button", { name: "تأیید" }).click();
    await expect(pendingRow).not.toBeVisible({ timeout: 15_000 });
  }

  const approvedRow = page.getByTestId("approved-requests").locator("[data-row]").filter({ hasText: productName }).filter({ hasText: qtyMarker }).first();
  await expect(approvedRow).toBeVisible({ timeout: 15_000 });
  await approvedRow.getByRole("button", { name: "ساخت حواله" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "ثبت حواله" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 15_000 });
  await expect(approvedRow).not.toBeVisible({ timeout: 15_000 });

  // ۳. حواله: فهرست با created_at DESC می‌آید، پس حواله‌ی تازه اولین ردیف ستون «بارگیری» است.
  const dispatchRow = page.getByTestId("to-load").locator("[data-row]").first();
  await expect(dispatchRow).toBeVisible({ timeout: 15_000 });
  const status = dispatchRow.locator("[data-status]");
  await expect(status).toHaveText("ثبت‌شده");
  const code = (await dispatchRow.locator("[dir=ltr]").first().innerText()).trim();

  await dispatchRow.getByRole("button", { name: "آماده بارگیری" }).click();
  await expect(status).toHaveText("آماده بارگیری", { timeout: 15_000 });

  // بارگیری برگشت‌ناپذیر است و تأیید می‌خواهد؛ بعدش حواله از ستون «بارگیری» بیرون می‌رود.
  await dispatchRow.getByRole("button", { name: "ثبت بارگیری" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "بله، بارگیری شد" }).click();
  await expect(page.getByTestId("to-load").getByText(code, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  await page.getByRole("tab", { name: "همه‌ی حواله‌ها" }).click();
  const loadedRow = page.getByTestId("dispatch-list").locator("tr[data-row]").filter({ hasText: code });
  await expect(loadedRow.locator("[data-status]")).toHaveText("بارگیری‌شده");

  expect(await totalOnHand()).toBe(onHandBefore - 7);
  await admin.end();
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
