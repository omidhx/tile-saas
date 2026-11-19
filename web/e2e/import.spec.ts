import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import * as XLSX from "xlsx";
import { STAFF, login, ALIGN_PALLETS } from "./helpers";

/**
 * فاز ۵: فایلِ اکسلِ واقعی از راهِ UI. در کدِ قبلی مرورگر سلولِ خالی را ۰ می‌فرستاد و
 * دکمه یک‌راست اعمال می‌کرد، پس موجودی صفر می‌شد. حالا پیش‌نمایش خطا می‌دهد و اعمال قفل است.
 *
 * کاربرِ staffِ جدا دارد، چون سقفِ ورودِ STAFF را specهای دیگر پر می‌کنند.
 */
const T = "11111111-1111-1111-1111-111111111111";
const W2 = "a3333333-3333-3333-3333-333333333334";
const LOT = "e5555555-0000-0000-0000-000000000001";
const IMPORTER = { phone: "09120000077", password: STAFF.password };

const admin = postgres(process.env.E2E_ADMIN_DATABASE_URL!, { max: 1 });
test.afterAll(async () => { await admin.end(); });

const onHand = async (lot: string) =>
  (await admin<{ v: number }[]>`SELECT on_hand_qty_boxes AS v FROM inventory_balance WHERE lot_id = ${lot}`)[0].v;
const w2Total = async () => (await admin<{ v: number }[]>`
  SELECT SUM(b.on_hand_qty_boxes)::int AS v FROM inventory_balance b JOIN inventory_lot l ON l.id = b.lot_id
  WHERE l.warehouse_id = ${W2}`)[0].v;

/** همه‌ی lotهای انبارِ یزد با موجودیِ فعلی؛ `qty` موجودیِ lotِ تست را تعیین می‌کند. */
async function w2File(qty: unknown): Promise<Buffer> {
  const lots = await admin<{ id: string; sku: string; batch: string; v: number }[]>`
    SELECT l.id, pv.sku, l.batch_number AS batch, b.on_hand_qty_boxes AS v
    FROM inventory_lot l JOIN inventory_balance b ON b.lot_id = l.id JOIN product_variant pv ON pv.id = l.variant_id
    WHERE l.warehouse_id = ${W2} ORDER BY l.id`;
  const ws = XLSX.utils.aoa_to_sheet([
    ["کد", "انبار", "بچ", "موجودی"],
    ...lots.map((l) => [l.sku, "W2", l.batch, l.id === LOT ? qty : l.v]),
  ]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "موجودی");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

async function upload(page: Page, file: Buffer) {
  await page.goto("/staff/catalog?tab=import");
  await page.locator("#xl").setInputFiles({ name: "stock.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file });
  // پارسِ فایل async است؛ بدونِ این صبر دکمه‌ی اعمال هنوز قفل بود و تست روی کدِ قبلی بی‌دلیل سبز می‌شد
  await expect(page.locator(".badge--ok").filter({ hasText: "ردیف" })).toBeVisible();
  await page.getByLabel("انتخاب انبار").selectOption(W2);
}

/** همان کاری که کارمند می‌کند: پیش‌نمایش (اگر هست)، و اگر دکمه‌ی اعمال باز بود، اعمال. */
async function previewThenApplyIfAllowed(page: Page) {
  const previewBtn = page.getByRole("button", { name: "پیش‌نمایش", exact: true });
  if (await previewBtn.count()) {
    const r = page.waitForResponse((r) => r.url().includes("/api/imports") && r.request().method() === "POST");
    await previewBtn.click();
    await r;
  }
  const applyBtn = page.getByRole("button", { name: /^اعمال/ });
  await expect(applyBtn).toBeVisible();
  if (await applyBtn.isEnabled()) {
    const r = page.waitForResponse((r) => r.url().includes("/api/imports") && r.request().method() === "POST");
    await applyBtn.click();
    await r;
  }
}

test("ایمپورت: فایلِ خراب موجودی را عوض نمی‌کند؛ فایلِ سالم اعمال و برگردانده می‌شود", async ({ page }) => {
  await admin.unsafe(`
    INSERT INTO app_user (id, phone, full_name, password_hash)
      SELECT 'e5555555-0000-0000-0000-0000000000aa', '${IMPORTER.phone}', 'کارمندِ ایمپورت', password_hash FROM app_user WHERE phone = '${STAFF.phone}'
      ON CONFLICT DO NOTHING;
    INSERT INTO tenant_membership (tenant_id, user_id, role, is_active) VALUES ('${T}', 'e5555555-0000-0000-0000-0000000000aa', 'staff', true)
      ON CONFLICT DO NOTHING;
    INSERT INTO inventory_lot (id, tenant_id, variant_id, warehouse_id, batch_number)
      VALUES ('${LOT}', '${T}', 'a2222222-2222-2222-2222-222222222226', '${W2}', 'E2E-IMP') ON CONFLICT DO NOTHING;
    INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES ('${T}', '${LOT}', 50) ON CONFLICT DO NOTHING;
    ${ALIGN_PALLETS}`);
  await login(page, IMPORTER);
  const before = await w2Total();

  await test.step("سلولِ موجودیِ خالی", async () => {
    await upload(page, await w2File(null));
    await previewThenApplyIfAllowed(page);
    expect(await onHand(LOT), "سلولِ خالی نباید موجودی را صفر کند").toBe(50);
    expect(await w2Total()).toBe(before);
    await expect(page.getByText("موجودی خالی است")).toBeVisible();
    await expect(page.getByRole("button", { name: /^اعمال/ })).toBeDisabled();
  });

  await test.step("«۱۲ کارتن» به‌جای عدد", async () => {
    await upload(page, await w2File("۱۲ کارتن"));
    await previewThenApplyIfAllowed(page);
    expect(await onHand(LOT)).toBe(50);
    expect(await w2Total()).toBe(before);
  });

  await test.step("فایلِ سالم با رقمِ فارسی: اعمال و بعد برگرداندن", async () => {
    await upload(page, await w2File("۷۰"));
    await previewThenApplyIfAllowed(page);
    expect(await onHand(LOT)).toBe(70);
    expect(await w2Total()).toBe(before + 20);

    page.once("dialog", (d) => d.accept());
    const r = page.waitForResponse((r) => r.url().includes("/api/imports") && r.request().method() === "DELETE");
    await page.getByRole("button", { name: "برگرداندن" }).first().click();
    expect((await r).status()).toBe(200);
    expect(await onHand(LOT)).toBe(50);
    expect(await w2Total()).toBe(before);
    await expect(page.getByText("برگردانده شد").first()).toBeVisible();
  });
});
