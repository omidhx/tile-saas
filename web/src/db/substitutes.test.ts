import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { suggestSubstitutes, addSubstitute, listSubstitutes, removeSubstitute } from "./substitutes";
import { T, seedTenant } from "./_fixtures";

/**
 * پیشنهاد کالای جایگزین. قاعده‌ی اصلی که تست‌ها قفلش می‌کنند:
 * **هرگز چیزی پیشنهاد نشود که خودش هم ناموجود است** — نماینده را دو بار ناامید می‌کند.
 */

const AG = "a5555555-5555-5555-5555-555555555555";
const PL = "aaaa1111-1111-1111-1111-111111111111";
const WH = "a3333333-3333-3333-3333-333333333333";

// محصولِ «خواسته‌شده» با دو درجه، و دو محصولِ دیگر
const P_WANT = "a1111111-1111-1111-1111-11111111110a";
const P_ALT  = "a1111111-1111-1111-1111-11111111110b";
const V_WANT   = "a2222222-2222-2222-2222-22222222220a"; // ناموجود
const V_GRADE2 = "a2222222-2222-2222-2222-22222222220b"; // همان محصول، درجه ۲ — موجود
const V_ALT    = "a2222222-2222-2222-2222-22222222220c"; // محصولِ دیگر — موجود
const V_DEAD   = "a2222222-2222-2222-2222-22222222220d"; // محصولِ دیگر — ناموجود

before(async () => {
  await resetSchema();
  await seedTenant();
  await sql.unsafe(`
    INSERT INTO price_list (id,tenant_id,name) VALUES ('${PL}','${T}','L');
    INSERT INTO agent_account (id,tenant_id,legal_name,code,price_list_id) VALUES ('${AG}','${T}','نماینده','AG1','${PL}');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','W','W1','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES
      ('${P_WANT}','${T}','WANT','کاشی خواسته‌شده'),
      ('${P_ALT}','${T}','ALT','کاشی جایگزین');
    INSERT INTO product_variant (id,tenant_id,product_id,sku,grade) VALUES
      ('${V_WANT}','${T}','${P_WANT}','W-1','۱'),
      ('${V_GRADE2}','${T}','${P_WANT}','W-2','۲'),
      ('${V_ALT}','${T}','${P_ALT}','A-1','۱'),
      ('${V_DEAD}','${T}','${P_ALT}','A-2','۲');
    INSERT INTO price_list_item (tenant_id,price_list_id,variant_id,price) VALUES
      ('${T}','${PL}','${V_GRADE2}',700000), ('${T}','${PL}','${V_ALT}',900000);
    -- موجودی: فقط GRADE2 و ALT. WANT و DEAD عمداً بدونِ lot.
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES
      ('a4444444-4444-4444-4444-44444444440b','${T}','${V_GRADE2}','${WH}'),
      ('a4444444-4444-4444-4444-44444444440c','${T}','${V_ALT}','${WH}');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES
      ('${T}','a4444444-4444-4444-4444-44444444440b',50),
      ('${T}','a4444444-4444-4444-4444-44444444440c',80);
  `);
});
after(async () => { await sql.end(); });
beforeEach(async () => { await sql`DELETE FROM product_substitute WHERE tenant_id = ${T}`; });

const suggest = () => suggestSubstitutes({ tenantId: T, agentAccountId: AG, variantIds: [V_WANT] });

test("همان محصول با درجه‌ی دیگر، بدونِ هیچ تنظیمی پیشنهاد می‌شود", async () => {
  const s = await suggest();
  const list = s[V_WANT] ?? [];
  assert.equal(list.length, 1, "فقط درجه‌ی ۲ که موجود است");
  assert.equal(list[0].variantId, V_GRADE2);
  assert.equal(list[0].source, "same_product");
  assert.equal(list[0].available, 50);
  assert.equal(list[0].unitPrice, 700000, "قیمتِ خودِ نماینده");
});

test("🔴 جایگزینِ ناموجود هرگز پیشنهاد نمی‌شود", async () => {
  await addSubstitute({ tenantId: T, variantId: V_WANT, substituteVariantId: V_DEAD, note: "مشابه" });
  const list = (await suggest())[V_WANT] ?? [];
  assert.ok(!list.some((x) => x.variantId === V_DEAD),
    "پیشنهادِ کالایی که آن هم نیست، از پیشنهاد ندادن بدتر است");
});

test("تعریفِ صریحِ کارخانه هم می‌آید، با توضیحش", async () => {
  await addSubstitute({ tenantId: T, variantId: V_WANT, substituteVariantId: V_ALT, note: "همان اندازه، لعاب مات" });
  const list = (await suggest())[V_WANT] ?? [];
  const alt = list.find((x) => x.variantId === V_ALT);
  assert.ok(alt, "جایگزینِ تعریف‌شده باید بیاید");
  assert.equal(alt.source, "explicit");
  assert.equal(alt.note, "همان اندازه، لعاب مات");
  assert.equal(alt.unitPrice, 900000);
});

test("تعریفِ صریح جلوتر از پیشنهادِ خودکار می‌آید", async () => {
  await addSubstitute({ tenantId: T, variantId: V_WANT, substituteVariantId: V_ALT, note: "اول این" });
  const list = (await suggest())[V_WANT] ?? [];
  assert.equal(list[0].variantId, V_ALT, "چیزی که آدم گفته باید اول باشد، نه حدسِ سیستم");
  assert.equal(list[1].variantId, V_GRADE2);
});

test("اگر کارخانه همان درجه‌ی دیگر را صریح تعریف کند، تکراری نمی‌شود", async () => {
  await addSubstitute({ tenantId: T, variantId: V_WANT, substituteVariantId: V_GRADE2, note: "درجه ۲" });
  const list = (await suggest())[V_WANT] ?? [];
  assert.equal(list.length, 1, "یک بار، نه دو بار");
  assert.equal(list[0].source, "explicit");
  assert.equal(list[0].note, "درجه ۲", "نسخه‌ی صریح برنده است چون توضیح دارد");
});

test("جهت‌دار است — تعریفِ A→B یعنی B جایگزینِ A، نه برعکس", async () => {
  await addSubstitute({ tenantId: T, variantId: V_WANT, substituteVariantId: V_ALT });
  const back = await suggestSubstitutes({ tenantId: T, agentAccountId: AG, variantIds: [V_ALT] });
  const list = back[V_ALT] ?? [];
  assert.ok(!list.some((x) => x.variantId === V_WANT),
    "«اگر گران نبود ارزان را بده» لزوماً برعکسش درست نیست");
});

test("کالا نمی‌تواند جایگزینِ خودش باشد", async () => {
  await assert.rejects(
    addSubstitute({ tenantId: T, variantId: V_WANT, substituteVariantId: V_WANT }),
  );
});

test("افزودن و حذف از فهرستِ staff", async () => {
  await addSubstitute({ tenantId: T, variantId: V_WANT, substituteVariantId: V_ALT, note: "n" });
  const rows = await listSubstitutes(T);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].variantName, "کاشی خواسته‌شده");
  assert.equal(rows[0].substituteName, "کاشی جایگزین");

  await removeSubstitute({ tenantId: T, id: rows[0].id });
  assert.equal((await listSubstitutes(T)).length, 0);
});

test("ورودی خالی، کوئری نمی‌زند و خالی برمی‌گرداند", async () => {
  assert.deepEqual(await suggestSubstitutes({ tenantId: T, agentAccountId: AG, variantIds: [] }), {});
});
