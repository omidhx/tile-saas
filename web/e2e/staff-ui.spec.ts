import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import postgres from "postgres";
import { STAFF, login } from "./helpers";

/**
 * پایه‌ی UI تازه (فاز ۶) روی کارتابل: راست‌به‌چپ، ۳۷۵ و ۱۴۴۰، تم روشن و تیره، صفحه‌کلید و axe.
 * برخلاف a11y.spec (baseline برای UI قدیمی)، صفحه‌ی تازه باید صفر خطای axe داشته باشد.
 */
const WIDTHS = [375, 1440] as const;

// کاربر staff جدا و یک ورود برای کل فایل: سقف ورود ۵ بار در ۱۵ دقیقه برای هر شناسه است و
// specهای دیگر سهم STAFF را مصرف می‌کنند. هر ورود موفق نشست‌های قبلی همان کاربر را هم باطل می‌کند.
const T = "11111111-1111-1111-1111-111111111111";
// دو کاربر: سقف API برای هر کاربر staff ۶۰ درخواست در دقیقه است (یافته‌ی ممیزی، اصلاحش فاز ۷) و
// هر بار باز شدن کارتابل ۷ GET است؛ تست‌های مسیر خطا با کاربر دوم سهم تست‌های اصلی را نمی‌خورند.
const UI_STAFF = { phone: "09120000066", password: STAFF.password, id: "e5555555-0000-0000-0000-0000000000bb" };
const UI_STAFF_ERR = { phone: "09120000065", password: STAFF.password, id: "e5555555-0000-0000-0000-0000000000bc" };
let storageState: BrowserContextOptions["storageState"];
let errStorageState: BrowserContextOptions["storageState"];

test.beforeAll(async ({ browser }) => {
  const admin = postgres(process.env.E2E_ADMIN_DATABASE_URL!, { max: 1 });
  for (const u of [UI_STAFF, UI_STAFF_ERR])
    await admin.unsafe(`
      INSERT INTO app_user (id, phone, full_name, password_hash)
        SELECT '${u.id}', '${u.phone}', 'کارمندِ تست UI', password_hash FROM app_user WHERE phone = '${STAFF.phone}'
        ON CONFLICT DO NOTHING;
      INSERT INTO tenant_membership (tenant_id, user_id, role, is_active) VALUES ('${T}', '${u.id}', 'staff', true)
        ON CONFLICT DO NOTHING;`);
  await admin.end();
  const signIn = async (u: { phone: string; password: string }) => {
    const ctx = await browser.newContext();
    await login(await ctx.newPage(), u);
    const state = await ctx.storageState();
    await ctx.close();
    return state;
  };
  storageState = await signIn(UI_STAFF);
  errStorageState = await signIn(UI_STAFF_ERR);
});

async function open(browser: Browser, width: number, theme: "light" | "dark"): Promise<Page> {
  const ctx = await browser.newContext({ storageState, viewport: { width, height: width === 375 ? 812 : 900 } });
  await ctx.addInitScript((t) => localStorage.setItem("tile.theme", t), theme);
  const page = await ctx.newPage();
  await page.goto("/staff");
  await expect(page.getByRole("heading", { name: "کارتابل" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "در حال بارگذاری" })).toHaveCount(0, { timeout: 15_000 });
  return page;
}

async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

for (const width of WIDTHS) {
  for (const theme of ["light", "dark"] as const) {
    test(`کارتابل ${width} ${theme}: axe صفر، راست‌به‌چپ، بدون اسکرول افقی`, async ({ browser }) => {
      const page = await open(browser, width, theme);
      expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(theme);
      expect(await page.evaluate(() => document.documentElement.dir)).toBe("rtl");
      // هر عنصری که از لبه‌ی صفحه بیرون زده، با کلاسش؛ خالی یعنی اسکرول افقی نیست
      expect(await page.evaluate(() => [...document.querySelectorAll("body *")]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1); })
        .slice(0, 5).map((el) => `${el.tagName}.${(el.getAttribute("class") ?? "").slice(0, 60)}`))).toEqual([]);
      if (width === 1440) {
        // سایدبار سمت راست است (شروع خط در RTL)
        const box = (await page.locator("aside").boundingBox())!;
        expect(box.x).toBeGreaterThan(width / 2);
      }
      expect(await axe(page)).toEqual([]);

      for (const tab of ["همه‌ی حواله‌ها", "کالای ناموجود"]) {
        await page.getByRole("tab", { name: tab }).click();
        expect(await axe(page)).toEqual([]);
      }
      // دیالوگ باز هم بررسی می‌شود؛ پرتال بیرون از main است
      await page.getByRole("button", { name: "ثبت کالای ناموجود" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await axe(page)).toEqual([]);
    });
  }
}

test("صفحه‌کلید: تب‌ها با کلید جهت در RTL، فرم با پیام خطا، Escape و برگشت فوکوس", async ({ browser }) => {
  const page = await open(browser, 1440, "light");
  // در RTL «بعدی» سمت چپ است، پس ArrowLeft تب بعد را می‌گیرد. بدون DirectionProvider برعکس بود.
  await page.getByRole("tab", { name: /صف کار/ }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "همه‌ی حواله‌ها" })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "کالای ناموجود" })).toHaveAttribute("aria-selected", "true");

  const trigger = page.getByRole("button", { name: "ثبت کالای ناموجود" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // ارسال خالی: هیچ درخواستی نمی‌رود، سه پیام خطا کنار فیلدها می‌آید و aria-invalid ست می‌شود
  await dialog.getByRole("button", { name: "ثبت", exact: true }).click();
  await expect(dialog.getByText("نمایندگی را انتخاب کنید.")).toBeVisible();
  await expect(dialog.getByText("کالا را انتخاب کنید.")).toBeVisible();
  await expect(dialog.getByLabel("تعداد کارتن")).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByLabel("تعداد کارتن")).toHaveAccessibleDescription(/عدد صحیح/);

  // فهرست مشتری باز: Escape اول فقط فهرست را می‌بندد و فرم پرشده می‌ماند (بازبین: قبلاً کل دیالوگ بسته می‌شد)
  await dialog.getByLabel("تعداد کارتن").fill("3");
  const customer = dialog.getByRole("combobox", { name: "مشتری (اختیاری)" });
  await customer.fill("نیست");
  await expect(dialog.getByRole("listbox")).toBeVisible();
  await expect(customer).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(dialog.getByRole("listbox")).toHaveCount(0);
  await expect(customer).toHaveAttribute("aria-expanded", "false");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("تعداد کارتن")).toHaveValue("3");

  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("بارگذاری ناموفق: «چیزی نیست» و شمارش صفر نشان داده نمی‌شود", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: errStorageState, viewport: { width: 1440, height: 900 } });
  await ctx.route("**/api/reservations?**", (r) => r.fulfill({ status: 500, body: "{}" }));
  const page = await ctx.newPage();
  await page.goto("/staff");
  await expect(page.getByRole("alert").filter({ hasText: "بارگذاری ناموفق (500)" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("رزروی برای تأیید نیست.")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /صف کار/ })).not.toContainText("(");
  await ctx.close();
});

test("کار ناموفق در دیالوگ: دیالوگ باز می‌ماند و خطا داخل خودش خوانده می‌شود", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: errStorageState, viewport: { width: 1440, height: 900 } });
  await ctx.route("**/api/sales-dispatches", (r) =>
    r.request().method() === "POST" ? r.fulfill({ status: 500, body: "{}" }) : r.fallback());
  const page = await ctx.newPage();
  await page.goto("/staff");
  await page.getByTestId("approved-requests").getByRole("button", { name: "ساخت حواله" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "ثبت حواله" }).click();
  await expect(dialog.getByRole("alert")).toContainText("خطای 500");
  await expect(dialog).toBeVisible();
  await ctx.close();
});

test("آدرس ناموجود: ۴۰۴ با layout فارسی و راست‌به‌چپ", async ({ page }) => {
  // با دو root layout، بدون catch-all این صفحه html خام انگلیسی بدون nonce بود (بازبین فاز ۶)
  for (const path of ["/nope", "/staff/nope"]) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  }
});

test("دیالوگ تأیید: فوکوس اول روی انصراف است و Escape کاری انجام نمی‌دهد", async ({ browser }) => {
  const page = await open(browser, 1440, "light");
  await page.getByRole("tab", { name: "همه‌ی حواله‌ها" }).click();
  // هر حواله‌ی ثبت‌شده یا آماده دکمه‌ی «لغو» دارد؛ seed:dev دو حواله‌ی ثبت‌شده دارد.
  const row = page.getByTestId("dispatch-list").locator("tr[data-row]").filter({ has: page.getByRole("button", { name: "لغو" }) }).first();
  const cancel = row.getByRole("button", { name: "لغو" });
  const before = await row.locator("[data-status]").innerText();
  await cancel.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "انصراف" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(row.locator("[data-status]")).toHaveText(before);
});
