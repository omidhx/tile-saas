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
const UI_STAFF = { phone: "09120000066", password: STAFF.password };
let storageState: BrowserContextOptions["storageState"];

test.beforeAll(async ({ browser }) => {
  const admin = postgres(process.env.E2E_ADMIN_DATABASE_URL!, { max: 1 });
  await admin.unsafe(`
    INSERT INTO app_user (id, phone, full_name, password_hash)
      SELECT 'e5555555-0000-0000-0000-0000000000bb', '${UI_STAFF.phone}', 'کارمندِ تست UI', password_hash FROM app_user WHERE phone = '${STAFF.phone}'
      ON CONFLICT DO NOTHING;
    INSERT INTO tenant_membership (tenant_id, user_id, role, is_active) VALUES ('${T}', 'e5555555-0000-0000-0000-0000000000bb', 'staff', true)
      ON CONFLICT DO NOTHING;`);
  await admin.end();
  const ctx = await browser.newContext();
  await login(await ctx.newPage(), UI_STAFF);
  storageState = await ctx.storageState();
  await ctx.close();
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
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
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
