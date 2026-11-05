import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql, resetSchema } from "./_testdb";
import { T, U, seedTenantUser, enableAllFeatures } from "./_fixtures";
import { getFeatures, setFeatures } from "./features";
import { ensureDefaultPriceList, resolvePrices } from "./pricing";
import { withTenant } from "./client";
import { reserve } from "./reservations";
import { suggestSubstitutes } from "./substitutes";
import { approveReservation } from "./salesRequests";
import { featureOff } from "@/auth/httpCtx";
import { FEATURE_DEFAULTS, normalizeFeatures } from "@/lib/features";

/**
 * هر کلید باید خودِ رفتار را عوض کند، نه فقط منو را. ردیفِ ذخیره‌شده‌ی یک امکانِ خاموش
 * نباید قیمت را عوض کند و نباید کسی را خودکار تأیید کند.
 */
const AG = "a5555555-5555-5555-5555-555555555555";
const PL_MAIN = "aaaa1111-1111-1111-1111-111111111111";
const PL_AGENT = "aaaa2222-1111-1111-1111-111111111111";
const WH = "a3333333-3333-3333-3333-333333333333";
const PRODUCT = "a1111111-1111-1111-1111-111111111111";
const V = "a2222222-2222-2222-2222-222222222222";
const V2 = "a2222222-2222-2222-2222-222222222223";
const LOT = "a4444444-4444-4444-4444-444444444444";
const LOT2 = "a4444444-4444-4444-4444-444444444445";

let seq = 0;
const reserveOne = () => reserve({
  tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: `f-${++seq}`,
  items: [{ lotId: LOT, quantityBoxes: 1 }],
});
const priceOf = async (qty = 1) =>
  (await resolvePrices({ tenantId: T, agentAccountId: AG, variantIds: [V], qtyByVariant: { [V]: qty } })).get(V);

before(async () => {
  await resetSchema();
  await seedTenantUser();
  await sql.unsafe(`
    INSERT INTO agent_account (id,tenant_id,legal_name,code,price_list_id) VALUES ('${AG}','${T}','Ag','AG1',NULL);
    INSERT INTO warehouse (id,tenant_id,code,name,type) VALUES ('${WH}','${T}','W1','W','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('${PRODUCT}','${T}','P','P');
    INSERT INTO product_variant (id,tenant_id,product_id,sku,grade,sqcm_per_box) VALUES
      ('${V}','${T}','${PRODUCT}','S1','A',10000), ('${V2}','${T}','${PRODUCT}','S2','B',10000);
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id,batch_number) VALUES
      ('${LOT}','${T}','${V}','${WH}','B1'), ('${LOT2}','${T}','${V2}','${WH}','B2');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT}',1000), ('${T}','${LOT2}',1000);
    INSERT INTO price_list (id,tenant_id,name,is_default) VALUES ('${PL_MAIN}','${T}','اصلی',TRUE), ('${PL_AGENT}','${T}','ویژه',FALSE);
    INSERT INTO price_list_item (tenant_id,price_list_id,variant_id,price) VALUES ('${T}','${PL_MAIN}','${V}',1000), ('${T}','${PL_AGENT}','${V}',800);
    UPDATE agent_account SET price_list_id = '${PL_AGENT}' WHERE id = '${AG}';
    INSERT INTO agent_price_override (tenant_id,agent_account_id,variant_id,price) VALUES ('${T}','${AG}','${V}',500);
    INSERT INTO volume_discount (tenant_id,variant_id,min_qty_boxes,percent_off) VALUES ('${T}','${V}',10,10);
    UPDATE tenant SET auto_approve_limit = 1000000 WHERE id = '${T}';
  `);
});

beforeEach(async () => {
  await sql`UPDATE tenant SET features = '{}'::jsonb WHERE id = ${T}`;
});

test("پیش‌فرضِ کارخانه‌ی تازه: فقط قیمت روشن است", async () => {
  assert.deepEqual(await getFeatures(T), FEATURE_DEFAULTS);
  assert.equal(FEATURE_DEFAULTS.pricing, true);
  for (const [k, v] of Object.entries(FEATURE_DEFAULTS)) if (k !== "pricing") assert.equal(v, false, k);
});

test("کلیدِ قیمت خاموش: بقیه‌ی امکاناتِ قیمت هم خاموش حساب می‌شوند، جایگزین نه", () => {
  const f = normalizeFeatures({ pricing: false, volume_discount: true, auto_approve: true, substitutes: true });
  assert.equal(f.volume_discount, false);
  assert.equal(f.auto_approve, false);
  assert.equal(f.substitutes, true);
});

test("قیمت خاموش: هیچ قیمتی برنمی‌گردد و سفارش بدونِ قیمت تأیید می‌شود", async () => {
  await setFeatures({ tenantId: T, actorUserId: U, changes: { pricing: false } });
  assert.equal(await priceOf(), undefined);

  const r = await reserveOne();
  assert.ok(r.ok);
  if (!r.ok) return;
  const a = await approveReservation({ tenantId: T, reservationId: r.reservationId, actorUserId: U });
  assert.ok(a.ok, "تأیید نباید به قیمت وابسته باشد");
  const [item] = await sql<{ unit_price_applied: string | null }[]>`
    SELECT sri.unit_price_applied FROM sales_request_item sri
    JOIN sales_request sr ON sr.id = sri.request_id WHERE sr.reservation_id = ${r.reservationId}`;
  assert.equal(item.unit_price_applied, null);
});

test("چند لیست خاموش: لیستِ وصل‌شده به نماینده نادیده گرفته می‌شود و لیستِ اصلی می‌آید", async () => {
  assert.equal((await priceOf())?.unitPrice, 1000);
  await setFeatures({ tenantId: T, actorUserId: U, changes: { price_lists: true } });
  assert.equal((await priceOf())?.unitPrice, 800);
});

test("قیمت اختصاصی خاموش: ردیفِ ذخیره‌شده اثر ندارد", async () => {
  assert.equal((await priceOf())?.source, "list");
  await setFeatures({ tenantId: T, actorUserId: U, changes: { agent_price: true } });
  const p = await priceOf();
  assert.equal(p?.source, "override");
  assert.equal(p?.unitPrice, 500);
});

test("تخفیف حجمی خاموش: پله‌ی ذخیره‌شده اعمال نمی‌شود", async () => {
  assert.equal((await priceOf(10))?.percentOff, 0);
  await setFeatures({ tenantId: T, actorUserId: U, changes: { volume_discount: true } });
  assert.equal((await priceOf(10))?.percentOff, 10);
});

test("تأیید خودکار خاموش: سقفِ ذخیره‌شده کسی را خودکار تأیید نمی‌کند", async () => {
  const off = await reserveOne();
  assert.ok(off.ok && !off.autoApproved);
  await setFeatures({ tenantId: T, actorUserId: U, changes: { auto_approve: true } });
  const on = await reserveOne();
  assert.ok(on.ok && on.autoApproved);
});

test("ورود قیمت و چند لیست: endpointِ امکانِ خاموش ۴۰۴ می‌دهد و با روشن‌شدن باز می‌شود", async () => {
  assert.equal((await featureOff(T, "price_import"))?.status, 404);
  assert.equal((await featureOff(T, "substitutes"))?.status, 404);
  assert.equal(await featureOff(T, "pricing"), null, "قیمت پیش‌فرض روشن است");
  await enableAllFeatures();
  assert.equal(await featureOff(T, "price_import"), null);
  assert.equal(await featureOff(T, "substitutes"), null);
});

test("جایگزین: موتورِ پیشنهاد کار می‌کند و گیتش در /api/alerts است", async () => {
  await enableAllFeatures();
  const subs = await suggestSubstitutes({ tenantId: T, agentAccountId: AG, variantIds: [V] });
  assert.equal(subs[V]?.[0]?.variantId, V2, "همان محصول، درجه‌ی دیگر");
});

test("لیست اصلی: اگر نبود ساخته می‌شود و دوباره ساختنش idempotent است", async () => {
  const T2 = "22222222-2222-2222-2222-222222222222";
  await sql.unsafe(`INSERT INTO tenant (id,name,slug) VALUES ('${T2}','B','b');`);
  const a = await withTenant(T2, (tx) => ensureDefaultPriceList(tx, T2));
  const b = await withTenant(T2, (tx) => ensureDefaultPriceList(tx, T2));
  assert.equal(a, b);
  const rows = await sql`SELECT id FROM price_list WHERE tenant_id = ${T2}`;
  assert.equal(rows.length, 1);
});

test("تغییرِ امکانات در دفترِ تغییرات ثبت می‌شود", async () => {
  await sql`DELETE FROM audit_log WHERE tenant_id = ${T} AND action = 'tenant_features.edit'`;
  await setFeatures({ tenantId: T, actorUserId: U, changes: { substitutes: true } });
  const rows = await sql`SELECT 1 FROM audit_log WHERE tenant_id = ${T} AND action = 'tenant_features.edit'`;
  assert.equal(rows.length, 1);
});
