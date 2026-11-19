import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import postgres from "postgres";
import { STAFF, login } from "./helpers";

/**
 * فاز ۷، انبار و پالت، از UI: ورود کالا (پالت ترکیبی، تکرار ×۲) → لیست → ویرایش → انتقال بخشی → خروج غیرفروش
 * → جمع موجودی. oracle مستقل از UI، با اتصال admin: on_hand، جمع پالت‌ها و لجر هر lot.
 * با SHOTS=<پوشه> اسکرین‌شات صفحه‌ها برای تأیید صاحب پروژه هم گرفته می‌شود.
 */
const T = "11111111-1111-1111-1111-111111111111";
const WH_STAFF = { id: "a8888888-8888-8888-8888-8888888888e7", phone: "09120000071", password: STAFF.password };
const SHOTS = process.env.SHOTS;
const BATCH = "E2E-P7";
let storageState: BrowserContextOptions["storageState"];
let admin: ReturnType<typeof postgres>;

test.beforeAll(async ({ browser }) => {
  admin = postgres(process.env.E2E_ADMIN_DATABASE_URL!, { max: 1 });
  await admin.unsafe(`
    INSERT INTO app_user (id, phone, full_name, password_hash)
      SELECT '${WH_STAFF.id}', '${WH_STAFF.phone}', 'انباردار تست', password_hash FROM app_user WHERE phone = '${STAFF.phone}'
      ON CONFLICT DO NOTHING;
    INSERT INTO tenant_membership (tenant_id, user_id, role, is_active) VALUES ('${T}', '${WH_STAFF.id}', 'staff', true)
      ON CONFLICT DO NOTHING;`);
  const ctx = await browser.newContext();
  await login(await ctx.newPage(), WH_STAFF);
  storageState = await ctx.storageState();
  await ctx.close();
});
test.afterAll(async () => { await admin.end(); });

async function open(browser: Browser, path: string, width = 1440, theme: "light" | "dark" = "light"): Promise<Page> {
  const ctx = await browser.newContext({ storageState, viewport: { width, height: width === 375 ? 812 : 900 } });
  await ctx.addInitScript((t) => localStorage.setItem("tile.theme", t), theme);
  const page = await ctx.newPage();
  await page.goto(path);
  await expect(page.getByRole("status").filter({ hasText: "در حال بارگذاری" })).toHaveCount(0, { timeout: 15_000 });
  return page;
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}
/** مثل staff-ui.spec، ولی سرستونِ پنهانِ جدول (sr-only زیر md، با clip) اسکرول نمی‌سازد و شمرده نمی‌شود. */
async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((el) => !el.closest("[class*='sr-only']"))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1); })
    .slice(0, 5).map((el) => `${el.tagName}.${(el.getAttribute("class") ?? "").slice(0, 60)}`))).toEqual([]);
}

async function lots() {
  return admin<{ sku: string; on_hand: number; pallets: number; ledger: number }[]>`
    SELECT pv.sku, b.on_hand_qty_boxes AS on_hand,
           COALESCE((SELECT SUM(qty_boxes) FROM pallet_item pi WHERE pi.lot_id = b.lot_id), 0)::int AS pallets,
           COALESCE((SELECT SUM(on_hand_delta_boxes) FROM inventory_transaction t WHERE t.lot_id = b.lot_id), 0)::int AS ledger
    FROM inventory_balance b JOIN inventory_lot l ON l.id = b.lot_id JOIN product_variant pv ON pv.id = l.variant_id
    WHERE l.batch_number = ${BATCH} ORDER BY pv.sku`;
}
async function allBalanced() {
  const [{ bad }] = await admin<{ bad: number }[]>`
    SELECT count(*)::int AS bad FROM inventory_balance b
    WHERE b.on_hand_qty_boxes <> COALESCE((SELECT SUM(qty_boxes) FROM pallet_item pi WHERE pi.lot_id = b.lot_id), 0)`;
  return bad;
}

test("ورود کالا تا خروج: پالت ترکیبی، ویرایش، انتقال بخشی، خروج و جمع موجودی", async ({ browser }) => {
  // ۱. ورود کالا: یک پالت ترکیبی (گرانیت ۶۰ + کاشی ۳۶) با تکرار ×۲ در ستون A از شماره‌ی ۳
  let page = await open(browser, "/warehouse/goods-in");
  await expect(page.getByRole("heading", { name: "ورود کالا" })).toBeVisible();
  await page.getByLabel("انبار").selectOption({ label: "انبار مرکزی" });
  await page.getByLabel("ستون").fill("A");
  await page.getByLabel("شماره").fill("3");
  await page.getByLabel("تکرار ×n").fill("2");
  await page.getByLabel("کالا", { exact: true }).fill("GB-6060 — گرانیت مشکی براق");
  await page.getByLabel("بچ").fill(BATCH);
  await page.getByLabel("کارتن").fill("60");
  await page.getByRole("button", { name: "درجه یا کالای دیگر روی همین پالت" }).click();
  await page.getByLabel("کالا ۲").fill("KS-3060 — کاشی سفید مات");
  await page.getByLabel("بچ").nth(1).fill(BATCH);
  await page.getByLabel("کارتن").nth(1).fill("36");
  await expect(page.getByText("جمع: ۲ پالت · ۱۹۲ کارتن")).toBeVisible();
  await expect(page.getByText("شماره‌های ۳ تا ۴")).toBeVisible();
  await shot(page, "1-goods-in");
  expect(await axe(page)).toEqual([]);
  await page.getByRole("button", { name: "ثبت ورود" }).click();
  await expect(page.getByRole("status").filter({ hasText: "۲ پالت با ۱۹۲ کارتن ثبت شد" })).toBeVisible({ timeout: 15_000 });
  expect(await lots()).toEqual([
    { sku: "GB-6060-A", on_hand: 120, pallets: 120, ledger: 120 },
    { sku: "KS-3060-A", on_hand: 72, pallets: 72, ledger: 72 },
  ]);

  // ۲. لیست کالاهای انبار: دو پالت ترکیبی در A-3 و A-4
  page = await open(browser, "/warehouse");
  await page.getByRole("searchbox", { name: "جستجوی پالت" }).fill(BATCH);
  const rows = page.getByTestId("pallets").locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("ستون A · شماره ۳");
  await expect(rows.first()).toContainText("ترکیبی");
  await shot(page, "2-pallet-list");
  expect(await axe(page)).toEqual([]);

  // ۳. ویرایش: پالت اول به B-1 و شمارش گرانیت ۶۰ → ۵۸ با دلیل
  const firstNo = (await rows.first().locator("td").first().innerText()).trim();
  await page.getByRole("button", { name: `ویرایش پالت ${toLatin(firstNo)}` }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("ستون").fill("B");
  await dialog.getByLabel("شماره").fill("1");
  await dialog.getByLabel(/تعداد کارتن گرانیت/).fill("58");
  await dialog.getByRole("button", { name: "ذخیره" }).click();
  await expect(dialog.getByText("دلیل را انتخاب کنید.")).toBeVisible();
  await dialog.getByLabel("دلیل").selectOption({ label: "اصلاح شمارش" });
  await shot(page, "3-edit-dialog");
  expect(await axe(page)).toEqual([]);
  await dialog.getByRole("button", { name: "ذخیره" }).click();
  await expect(page.getByRole("status").filter({ hasText: "ویرایش شد" })).toBeVisible();
  await expect(rows.filter({ hasText: "ستون B · شماره ۱" })).toHaveCount(1);

  // ۴. انتقال بخشی: ۲۰ کارتن گرانیت از پالت دوم به C-1 → پالت تازه؛ on_hand ثابت
  const second = rows.filter({ hasText: "ستون A · شماره ۴" });
  const secondNo = toLatin((await second.locator("td").first().innerText()).trim());
  await page.getByRole("button", { name: `انتقال پالت ${secondNo}` }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("ستون مقصد").fill("C");
  await dialog.getByLabel("شماره").fill("1");
  await dialog.getByLabel(/کارتن برای انتقال گرانیت/).fill("20");
  await dialog.getByLabel(/کارتن برای انتقال کاشی/).fill("0");
  await shot(page, "4-transfer-dialog");
  await dialog.getByRole("button", { name: "انتقال" }).click();
  await expect(page.getByRole("status").filter({ hasText: "به پالت تازه" })).toBeVisible();
  await expect(rows).toHaveCount(3);

  // ۵. خروج غیرفروش: ۵ کارتن گرانیت از پالت B-1، شکستگی
  await page.getByRole("button", { name: `خروج از پالت ${toLatin(firstNo)}` }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(/کارتن خروجی گرانیت/).fill("5");
  await dialog.getByLabel("دلیل").selectOption({ label: "شکستگی" });
  await dialog.getByLabel("توضیح").fill("افتادن از لیفتراک");
  await shot(page, "5-exit-dialog");
  expect(await axe(page)).toEqual([]);
  await dialog.getByRole("button", { name: "ثبت خروج" }).click();
  await expect(page.getByRole("status").filter({ hasText: "خروج از پالت" })).toBeVisible();
  await page.getByRole("tab", { name: "خروج‌ها" }).click();
  await expect(page.getByTestId("exits").locator("tbody tr").first()).toContainText("افتادن از لیفتراک");
  await shot(page, "6-exits");

  expect(await lots()).toEqual([
    { sku: "GB-6060-A", on_hand: 113, pallets: 113, ledger: 113 },
    { sku: "KS-3060-A", on_hand: 72, pallets: 72, ledger: 72 },
  ]);
  expect(await allBalanced()).toBe(0);

  // ۶. جمع موجودی
  page = await open(browser, "/warehouse/stock");
  await page.getByRole("searchbox", { name: "جستجوی کالا" }).fill("GB-6060");
  const stockRows = page.getByTestId("stock").locator("tbody tr");
  await expect(stockRows).toHaveCount(2); // گرانیت در دو انبار
  await expect(stockRows.filter({ hasText: "انبار مرکزی" })).toHaveCount(1);
  await shot(page, "7-stock");
  expect(await axe(page)).toEqual([]);
});

for (const [width, theme] of [[375, "light"], [1440, "dark"]] as const) {
  test(`صفحه‌های انبار ${width} ${theme}: axe صفر و بدون اسکرول افقی`, async ({ browser }) => {
    for (const [path, name] of [["/warehouse", "list"], ["/warehouse/goods-in", "goods-in"], ["/warehouse/stock", "stock"]]) {
      const page = await open(browser, path, width, theme);
      await noHorizontalOverflow(page);
      expect(await axe(page)).toEqual([]);
      await shot(page, `8-${name}-${width}-${theme}`);
      await page.context().close();
    }
  });
}

/** شماره‌ی فارسی ردیف به لاتین، برای نام دسترس‌پذیر دکمه‌ها که عدد لاتین دارند. */
function toLatin(s: string) { return s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))); }
