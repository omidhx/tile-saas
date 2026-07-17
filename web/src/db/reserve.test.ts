import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sql } from "./client";
import { reserve } from "./reservations";

// تستِ یکپارچه — نیازمند DATABASE_URL به یک Postgres تازه. schema.sql خودش بارگذاری می‌شه.
// اجرا: DATABASE_URL=... node --import tsx --test src/db/reserve.test.ts

const T = "11111111-1111-1111-1111-111111111111"; // tenant
const AG = "a5555555-5555-5555-5555-555555555555"; // agent
const LOT1 = "a4444444-4444-4444-4444-444444444444"; // on_hand 100
const LOT2 = "a9999999-9999-9999-9999-999999999999"; // on_hand 3

before(async () => {
  // BEGIN;/COMMIT; حذف می‌شن: postgres.js تراکنش صریح روی کانکشن pool را رد می‌کنه
  // (UNSAFE_TRANSACTION). بدون آن‌ها، multi-statement روی simple-protocol خودش atomic است.
  const schema = readFileSync(new URL("../../../db/schema.sql", import.meta.url), "utf8")
    .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
  await sql.unsafe(schema);
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','P1');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('a2222222-2222-2222-2222-222222222222','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('a3333333-3333-3333-3333-333333333333','${T}','W','W1','main');
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES
      ('${LOT1}','${T}','a2222222-2222-2222-2222-222222222222','a3333333-3333-3333-3333-333333333333'),
      ('${LOT2}','${T}','a2222222-2222-2222-2222-222222222222','a3333333-3333-3333-3333-333333333333');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT1}',100), ('${T}','${LOT2}',3);
  `);
});

after(async () => { await sql.end(); });

const base = { tenantId: T, agentAccountId: AG, ttlHours: 24 };

test("رزرو موفق وقتی available کافیه", async () => {
  const r = await reserve({ ...base, idempotencyKey: "k1", items: [{ lotId: LOT1, quantityBoxes: 10 }] });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.deduped, false);
});

test("idempotency: کلید تکراری همون رزرو را برمی‌گردونه، نه رزرو دوم", async () => {
  const first = await reserve({ ...base, idempotencyKey: "k1", items: [{ lotId: LOT1, quantityBoxes: 10 }] });
  assert.equal(first.ok && first.deduped, true);
  const [{ count }] = await sql<{ count: string }[]>`SELECT count(*) FROM reservation WHERE idempotency_key='k1'`;
  assert.equal(Number(count), 1, "باید فقط یک رزرو با این کلید باشه");
});

test("۴۰۹: available کمتر از requested → رد با conflict", async () => {
  const r = await reserve({ ...base, idempotencyKey: "k2", items: [{ lotId: LOT1, quantityBoxes: 999 }] });
  assert.equal(r.ok, false);
  // held فعلی روی LOT1 = ۱۰ (از تست اول) → available = 100-10 = 90
  assert.equal(!r.ok && r.conflict.available, 90);
});

test("all-or-nothing: اگه یک lot کم بیاد، هیچ‌کدوم رزرو نمی‌شن", async () => {
  const r = await reserve({
    ...base, idempotencyKey: "k3",
    items: [{ lotId: LOT1, quantityBoxes: 5 }, { lotId: LOT2, quantityBoxes: 999 }],
  });
  assert.equal(r.ok, false); // LOT2 فقط ۳ داره
  // اثبات نصفه‌رزرو نشدن: هیچ reservation_item‌ای برای این تراکنش ساخته نشده
  const rows = await sql`SELECT 1 FROM reservation WHERE idempotency_key='k3'`;
  assert.equal(rows.length, 0, "رزرو نصفه نباید ساخته بشه");
});
