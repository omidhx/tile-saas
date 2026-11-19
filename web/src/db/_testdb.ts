import { readFileSync } from "node:fs";
import { after } from "node:test";
import postgres from "postgres";
import { sql as appSql } from "./client";

// دو اتصال، با قصد:
//   appSql (DATABASE_URL)           نقش محدود app_user؛ کد محصول از client.ts با همین اجرا می‌شود و RLS فعال است.
//   sql    (TEST_ADMIN_DATABASE_URL) superuser؛ فقط برای reset، seed و خواندنِ مستقلِ نتیجه در خود تست.
// اگر تستی چیزی را از مسیر محصول با sql بخواند، RLS را دور زده است؛ کد محصول همیشه appSql می‌بیند.
const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
if (!adminUrl) throw new Error("TEST_ADMIN_DATABASE_URL تنظیم نشده — تست‌ها با --env-file=.env.test اجرا می‌شوند.");

export const sql = postgres(adminUrl, { max: 4, onnotice: () => {} });
export { appSql };

// هر فایل تستی که این ماژول را import می‌کند، بسته‌شدن هر دو pool را به ارث می‌برد.
// بدون این، pool بازِ postgres.js پروسه‌ی تست را تا ابد زنده نگه می‌دارد.
after(async () => {
  await Promise.all([sql.end(), appSql.end()]);
});

/**
 * گاردِ ایمنی: resetSchema کلِ schema را DROP می‌کند. اگر URL به‌اشتباه به پایگاه‌داده‌ی
 * توسعه یا تولید اشاره کند، همه‌چیز بی‌سروصدا پاک می‌شود. پس نامِ DB باید صریحاً به `_test`
 * ختم شود — یک بار همین اتفاق افتاد. نقش هم باید همان نقشی باشد که grantها به آن داده می‌شود.
 */
function assertTestDatabase(): URL {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL تنظیم نشده — تست‌ها با --env-file=.env.test اجرا می‌شوند.");
  const app = new URL(url);
  const admin = new URL(adminUrl!);
  const dbName = app.pathname.slice(1);
  if (!dbName.endsWith("_test") || admin.pathname !== app.pathname) {
    throw new Error(
      `تست‌ها فقط روی پایگاه‌داده‌ای که نامش به «_test» ختم می‌شود اجرا می‌شوند و هر دو اتصال باید روی همان DB باشند. ` +
      `الان: «${dbName}» و «${admin.pathname.slice(1)}». (resetSchema کلِ schema را DROP می‌کند.)`,
    );
  }
  if (app.username !== "app_user") {
    throw new Error(`DATABASE_URL تست باید با نقش app_user وصل شود، نه «${app.username}».`);
  }
  return app;
}

/** اگر تست‌ها با نقشی اجرا شوند که RLS را دور می‌زند، هیچ تستی چیزی درباره‌ی ایزوله ثابت نمی‌کند. */
export async function assertAppRoleIsRestricted() {
  const [role] = await appSql<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (!role || role.rolsuper || role.rolbypassrls) {
    throw new Error(
      `نقش تست باید non-superuser و بدون BYPASSRLS باشد، ولی این است: ${JSON.stringify(role)}`,
    );
  }
}

const load = (file: string) =>
  readFileSync(new URL(`../../../db/${file}`, import.meta.url), "utf8")
    // BEGIN;/COMMIT; حذف: postgres.js تراکنش صریح روی pool را رد می‌کنه (UNSAFE_TRANSACTION)
    .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");

// اسکیمای تازه از schema.sql (منبع حقیقت). هر فایل تست قبل از seedِ خودش صداش می‌زنه؛
// با --test-concurrency=1 فایل‌ها سریال اجرا می‌شن، پس یک DB مشترک امنه.
export async function resetSchema() {
  const app = assertTestDatabase();
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await sql.unsafe(load("schema.sql"));
  // DROP SCHEMA همه‌ی grantها را می‌برد؛ همان فایلی که production استفاده می‌کند دوباره اجرا می‌شود.
  await sql.unsafe(load("create-app-user.sql"));
  await sql.unsafe(`ALTER ROLE app_user PASSWORD '${decodeURIComponent(app.password).replaceAll("'", "''")}'`);
  await assertAppRoleIsRestricted();
}

/**
 * seedِ تست موجودی را مستقیم در inventory_balance می‌نویسد. از فاز ۷ جمعِ پالت‌های هر lot باید با
 * on_hand برابر باشد (تریگرِ deferredِ check_pallet_sum)، پس هر seed یا UPDATEِ مستقیمِ on_hand در
 * **همان تراکنش** این را هم اجرا می‌کند: برای هر lotِ ناتراز، ردیف‌های پالتش پاک و یک پالتِ «بدون محل»
 * با همان on_hand ساخته می‌شود. فقط برای تست؛ کد محصول هرگز موجودی را این‌طور «تراز» نمی‌کند.
 */
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

/** همان ALIGN_PALLETS برای seedی که با چند دستورِ جدا نوشته می‌شود: همه در یک تراکنش. */
export async function withAlignedPallets(fn: (tx: postgres.TransactionSql) => Promise<unknown>) {
  await sql.begin(async (tx) => {
    await fn(tx);
    await tx.unsafe(ALIGN_PALLETS);
  });
}
