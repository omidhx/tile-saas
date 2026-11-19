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

/** هم‌ارزِ ALIGN_PALLETS در src/db/_testdb.ts: seedِ مستقیمِ balance باید در همان تراکنش پالتِ هم‌جمع بسازد (check_pallet_sum). */
export const ALIGN_PALLETS = `
WITH bad AS MATERIALIZED (
  SELECT gen_random_uuid() AS pid, b.tenant_id, b.lot_id, l.warehouse_id, b.on_hand_qty_boxes AS q
  FROM inventory_balance b JOIN inventory_lot l ON l.id = b.lot_id
  WHERE b.on_hand_qty_boxes <> COALESCE((SELECT SUM(qty_boxes) FROM pallet_item pi WHERE pi.lot_id = b.lot_id), 0)
), del AS (DELETE FROM pallet_item pi USING bad WHERE pi.lot_id = bad.lot_id),
p AS (INSERT INTO pallet (id, tenant_id, warehouse_id) SELECT pid, tenant_id, warehouse_id FROM bad WHERE q > 0)
INSERT INTO pallet_item (tenant_id, pallet_id, lot_id, warehouse_id, qty_boxes)
SELECT tenant_id, pid, lot_id, warehouse_id, q FROM bad WHERE q > 0;
`;
