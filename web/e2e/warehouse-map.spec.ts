import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import postgres from "postgres";
import { ALIGN_PALLETS, STAFF, login } from "./helpers";

/**
 * فاز ۸، نقشه‌ی انبار، از UI: مدیر چیدمان را می‌کشد (کلیک و کشیدن ماوس، راهرو) → پالت بیرون از نقشه را روی
 * جایش می‌کشد → با «جابه‌جایی» و کلیک جای دیگری می‌برد → جستجوی کالا روی نقشه. کارمند ساده چیدمان را
 * نمی‌تواند عوض کند (۴۰۳). oracle مستقل با اتصال admin: خانه‌ها، محل پالت و ناوردای پالت.
 * انبار و کالای خودش را دارد تا روی شمارش‌های warehouse.spec اثر نگذارد. SHOTS=<پوشه> اسکرین‌شات می‌گیرد.
 */
const T = "11111111-1111-1111-1111-111111111111";
const ADMIN = { id: "a8888888-8888-8888-8888-8888888888e8", phone: "09120000081", password: STAFF.password };
const CLERK = { id: "a8888888-8888-8888-8888-8888888888e9", phone: "09120000082", password: STAFF.password };
const WH = "a3333333-3333-3333-3333-3333333338e8";
const PRODUCT = "a1111111-1111-1111-1111-1111111118e8";
const VARIANT = "a2222222-2222-2222-2222-2222222228e8";
const LOT = { free: "a4444444-4444-4444-4444-4444444448e1", partial: "a4444444-4444-4444-4444-4444444448e2", reserved: "a4444444-4444-4444-4444-4444444448e3" };
const SHOTS = process.env.SHOTS;
const state: Record<string, BrowserContextOptions["storageState"]> = {};
let admin: ReturnType<typeof postgres>;

test.beforeAll(async ({ browser }) => {
  admin = postgres(process.env.E2E_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });
  await admin.begin(async (tx) => {
    await tx.unsafe(`
      INSERT INTO app_user (id, phone, full_name, password_hash)
        SELECT u.id::uuid, u.phone, u.name, s.password_hash FROM app_user s,
          (VALUES ('${ADMIN.id}', '${ADMIN.phone}', 'مدیر نقشه'), ('${CLERK.id}', '${CLERK.phone}', 'کارمند نقشه')) AS u(id, phone, name)
        WHERE s.phone = '${STAFF.phone}'
        ON CONFLICT DO NOTHING;
      INSERT INTO tenant_membership (tenant_id, user_id, role, is_active) VALUES
        ('${T}', '${ADMIN.id}', 'admin', true), ('${T}', '${CLERK.id}', 'staff', true) ON CONFLICT DO NOTHING;
      INSERT INTO warehouse (id, tenant_id, name, code, type) VALUES ('${WH}', '${T}', 'انبار نقشه', 'WMAP', 'main') ON CONFLICT DO NOTHING;
      INSERT INTO product (id, tenant_id, code, name) VALUES ('${PRODUCT}', '${T}', 'MAP-01', 'کاشی نقشه‌ای') ON CONFLICT DO NOTHING;
      INSERT INTO product_variant (id, tenant_id, product_id, sku, grade, boxes_per_pallet, sqcm_per_box)
        VALUES ('${VARIANT}', '${T}', '${PRODUCT}', 'MAP-01-1', '۱', 96, 14400) ON CONFLICT DO NOTHING;
      INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id, batch_number) VALUES
        ('${LOT.free}', '${T}', '${VARIANT}', '${WH}', 'MAPFREE'), ('${LOT.partial}', '${T}', '${VARIANT}', '${WH}', 'MAPPART'),
        ('${LOT.reserved}', '${T}', '${VARIANT}', '${WH}', 'MAPRES') ON CONFLICT DO NOTHING;
      INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes, blocked_qty_boxes) VALUES
        ('${T}', '${LOT.free}', 40, 0), ('${T}', '${LOT.partial}', 30, 10), ('${T}', '${LOT.reserved}', 20, 20) ON CONFLICT DO NOTHING;
      INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, note)
        SELECT '${T}', l, 'import_snapshot', q, 'e2e نقشه' FROM (VALUES ('${LOT.free}'::uuid, 40), ('${LOT.partial}'::uuid, 30), ('${LOT.reserved}'::uuid, 20)) AS v(l, q)
        WHERE NOT EXISTS (SELECT 1 FROM inventory_transaction t WHERE t.lot_id = v.l);`);
    await tx.unsafe(ALIGN_PALLETS);
    // پالتِ تمام‌رزرو از قبل محل B1 را دارد؛ با کشیدن چیدمان باید خودبه‌خود روی نقشه بیاید
    await tx`UPDATE pallet SET column_code = 'b', position_no = 1 WHERE id = (SELECT pallet_id FROM pallet_item WHERE lot_id = ${LOT.reserved})`;
  });
  for (const u of [ADMIN, CLERK]) {
    const ctx = await browser.newContext();
    await login(await ctx.newPage(), u);
    state[u.phone] = await ctx.storageState();
    await ctx.close();
  }
});
test.afterAll(async () => { await admin.end(); });

async function open(browser: Browser, user: { phone: string }, width = 1440, theme: "light" | "dark" = "light"): Promise<Page> {
  const ctx = await browser.newContext({ storageState: state[user.phone], viewport: { width, height: width === 375 ? 812 : 900 } });
  await ctx.addInitScript((t) => localStorage.setItem("tile.theme", t), theme);
  const page = await ctx.newPage();
  await page.goto("/warehouse/map");
  await expect(page.getByRole("status").filter({ hasText: "در حال بارگذاری" })).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("option", { hasText: "انبار نقشه" })).toHaveCount(1);
  await page.getByLabel("انبار", { exact: true }).selectOption({ label: "انبار نقشه" });
  await expect(page.getByRole("heading", { name: /بیرون از نقشه/ })).toBeVisible();
  return page;
}
const shot = async (page: Page, name: string) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
async function axe(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}
/** مثل warehouse.spec، ولی نقشه داخل قاب اسکرول‌دار خودش است ([data-map-scroll])؛ خود صفحه نباید اسکرول افقی بخورد. */
async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((el) => !el.closest("[class*='sr-only'], [data-map-scroll] > *"))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1); })
    .slice(0, 5).map((el) => `${el.tagName}.${(el.getAttribute("class") ?? "").slice(0, 60)}`))).toEqual([]);
}
const fa = (n: number) => n.toLocaleString("fa-IR");
const palletOf = async (lot: string) => (await admin<{ id: string; no: number; col: string | null; pos: number | null }[]>`
  SELECT p.id, p.pallet_no::int AS no, p.column_code AS col, p.position_no AS pos FROM pallet p JOIN pallet_item pi ON pi.pallet_id = p.id
  WHERE pi.lot_id = ${lot}`)[0];
async function balanced() {
  const [{ bad }] = await admin<{ bad: number }[]>`
    SELECT count(*)::int AS bad FROM inventory_balance b
    WHERE b.on_hand_qty_boxes <> COALESCE((SELECT SUM(qty_boxes) FROM pallet_item pi WHERE pi.lot_id = b.lot_id), 0)`;
  return bad;
}

test("کشیدن چیدمان، گذاشتن پالت روی نقشه، جابه‌جایی و جستجو", async ({ browser }) => {
  // ۱. بدون چیدمان: پیام و همه‌ی پالت‌ها بیرون از نقشه
  let page = await open(browser, ADMIN);
  await expect(page.getByText("هنوز چیدمانی برای این انبار کشیده نشده")).toBeVisible();
  await shot(page, "1-map-empty");

  // ۲. ویرایشگر: A1..A3 با کلیک، راهرو، و B1..B3 با کشیدن ماوس روی سه خانه
  await page.getByRole("button", { name: "ویرایش چیدمان" }).click();
  await expect(page.getByRole("heading", { name: "ویرایش چیدمان" })).toBeVisible();
  for (const x of [0, 1, 2]) await page.locator(`[data-cell="${x},0"]`).click();
  await page.getByRole("radio", { name: "راهرو" }).click();
  for (const x of [0, 1, 2]) await page.locator(`[data-cell="${x},1"]`).click();
  await page.getByRole("radio", { name: "جای پالت" }).click();
  await page.getByLabel("ستون", { exact: true }).fill("B");
  await expect(page.getByLabel("شماره‌ی بعدی")).toHaveValue("1");
  const center = async (x: number) => {
    const b = (await page.locator(`[data-cell="${x},2"]`).boundingBox())!;
    return [b.x + b.width / 2, b.y + b.height / 2] as const;
  };
  await page.mouse.move(...await center(0));
  await page.mouse.down();
  await page.mouse.move(...await center(1), { steps: 4 });
  await page.mouse.move(...await center(2), { steps: 4 });
  await page.mouse.up();
  for (const [x, y, name] of [[0, 0, "A۱"], [2, 0, "A۳"], [0, 2, "B۱"], [2, 2, "B۳"]] as const)
    await expect(page.locator(`[data-cell="${x},${y}"]`)).toHaveText(name);
  expect(await axe(page)).toEqual([]);
  await shot(page, "2-layout-editor");
  await page.getByRole("button", { name: "ذخیره‌ی چیدمان" }).click();
  await expect(page.getByText("چیدمان ذخیره شد: ۶ جای پالت و ۳ راهرو.")).toBeVisible();
  const cells = await admin<{ k: string }[]>`
    SELECT kind || ':' || COALESCE(column_code || position_no, '') || '@' || x || ',' || y AS k FROM warehouse_cell WHERE warehouse_id = ${WH} ORDER BY y, x`;
  expect(cells.map((c) => c.k)).toEqual(["slot:A1@0,0", "slot:A2@1,0", "slot:A3@2,0", "aisle:@0,1", "aisle:@1,1", "aisle:@2,1", "slot:B1@0,2", "slot:B2@1,2", "slot:B3@2,2"]);

  // ۳. پالتِ تمام‌رزرو با محل «b 1» خودش روی B1 است؛ دو پالتِ دیگر بیرون از نقشه
  await expect(page.locator('[data-slot="B1"]')).toHaveAccessibleName(/تمام رزرو/);
  await expect(page.getByRole("heading", { name: /بیرون از نقشه/ })).toContainText("۲");

  // ۴. کشیدن پالتِ آزاد از «بیرون از نقشه» روی A2
  const free = await palletOf(LOT.free);
  await page.getByRole("button", { name: new RegExp(`^پالت ${fa(free.no)}(?![۰-۹])`) }).dragTo(page.locator('[data-slot="A2"]'));
  await expect(page.getByText(`به A۲ منتقل شد`)).toBeVisible();
  expect(await palletOf(LOT.free)).toMatchObject({ col: "A", pos: 2 });
  await expect(page.locator('[data-slot="A2"]')).toHaveAccessibleName(/آزاد/);

  // ۵. بدون ماوس: انتخاب، «جابه‌جایی»، بعد جای مقصد
  await page.locator('[data-slot="A2"]').click();
  await page.getByRole("button", { name: `جابه‌جایی پالت ${free.no} روی نقشه` }).click();
  await expect(page.getByText(/جای مقصد پالت .* را روی نقشه بزنید/)).toBeVisible();
  await page.locator('[data-slot="B3"]').click();
  await expect(page.getByText(`به B۳ منتقل شد`)).toBeVisible();
  expect(await palletOf(LOT.free)).toMatchObject({ col: "B", pos: 3 });
  // پالتِ بخشی‌رزرو را هم با کشیدن روی A1
  const part = await palletOf(LOT.partial);
  await page.getByRole("button", { name: new RegExp(`^پالت ${fa(part.no)}(?![۰-۹])`) }).dragTo(page.locator('[data-slot="A1"]'));
  await expect(page.getByText(`به A۱ منتقل شد`)).toBeVisible();
  await expect(page.locator('[data-slot="A1"]')).toHaveAccessibleName(/بخشی رزرو/);
  await shot(page, "3-map-placed");

  // ۶. جستجو: بچ پالتِ آزاد روی B3 پیدا می‌شود؛ بقیه کم‌رنگ
  await page.getByLabel("جستجوی کالا روی نقشه").fill("mapfree");
  await expect(page.getByText("۱ پالت پیدا شد؛ ۱ روی نقشه.")).toBeVisible();
  await expect(page.locator('[data-slot="B3"]')).toHaveAccessibleName(/\(پیدا شد\)/);
  await expect(page.locator('[data-slot="A1"]')).not.toHaveAccessibleName(/پیدا شد/);
  expect(await axe(page)).toEqual([]);
  await shot(page, "4-map-search");

  // ۷. جزئیات جا با دکمه‌های همان پالت
  await page.locator('[data-slot="B3"]').click();
  await expect(page.getByRole("region", { name: "جزئیات" })).toContainText(`پالت ${fa(free.no)}`);
  await shot(page, "5-map-details");
  expect(await balanced()).toBe(0);
  await page.context().close();
});

test("کارمند ساده نقشه را می‌بیند و جابه‌جا می‌کند ولی چیدمان را نه (۴۰۳)", async ({ browser }) => {
  const page = await open(browser, CLERK);
  await expect(page.getByRole("button", { name: "ویرایش چیدمان" })).toHaveCount(0);
  const r = await page.request.put("/api/warehouse-map", { data: { tenantId: T, warehouseId: WH, cells: [] } });
  expect(r.status()).toBe(403);
  const [{ n }] = await admin<{ n: number }[]>`SELECT count(*)::int AS n FROM warehouse_cell WHERE warehouse_id = ${WH}`;
  expect(n).toBe(9);
  await page.context().close();
});

for (const [width, theme] of [[375, "light"], [1440, "dark"]] as const) {
  test(`نقشه‌ی انبار ${width} ${theme}: axe صفر و بدون اسکرول افقی صفحه`, async ({ browser }) => {
    const page = await open(browser, ADMIN, width, theme);
    await expect(page.locator('[data-slot="B1"]')).toBeVisible();
    await noHorizontalOverflow(page);
    expect(await axe(page)).toEqual([]);
    await shot(page, `6-map-${width}-${theme}`);
    await page.getByRole("button", { name: "ویرایش چیدمان" }).click();
    await noHorizontalOverflow(page);
    expect(await axe(page)).toEqual([]);
    await shot(page, `7-editor-${width}-${theme}`);
    await page.context().close();
  });
}
