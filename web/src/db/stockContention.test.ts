import { test, before } from "node:test";
import assert from "node:assert/strict";
import { sql, resetSchema } from "./_testdb";
import { reserve } from "./reservations";
import { T, seedTenant } from "./_fixtures";

/**
 * رقابت واقعی چند نماینده روی یک موجودی (قانون ۴: ردیف inventory_balance تنها mutex هر lot است).
 *
 * موازی‌کاری ساده پنجره‌ی race را آن‌قدر کوچک می‌گذارد که بدون قفل هم معمولاً پاس می‌شود.
 * پس trigger تستی روی INSERT رزرو می‌خوابد: بین خواندن held و commit، تراکنش‌های دیگر هم
 * موجودی را می‌خوانند. با FOR UPDATE سریالی می‌شوند؛ بدون آن همه همان held قدیمی را می‌بینند
 * و oversell می‌شود. نتیجه با اتصال admin خوانده می‌شود تا oracle مستقل از کد محصول باشد.
 */

const AG = "a5555555-5555-5555-5555-555555555555";
const V = "a2222222-2222-2222-2222-222222222222";
const LOT_A = "a4444444-4444-4444-4444-44444444444a";
const LOT_B = "a4444444-4444-4444-4444-44444444444b";

const held = async (lotId: string) => {
  const [row] = await sql<{ held: number }[]>`
    SELECT COALESCE(SUM(ri.quantity_boxes), 0)::int AS held
    FROM reservation_item ri JOIN reservation r ON r.id = ri.reservation_id
    WHERE ri.lot_id = ${lotId} AND r.status = 'active' AND r.expires_at > now()`;
  return row.held;
};

const setStock = async (a: number, b: number) => {
  await sql`DELETE FROM reservation_item`;
  await sql`DELETE FROM reservation`;
  await sql`UPDATE inventory_balance SET on_hand_qty_boxes = ${a} WHERE lot_id = ${LOT_A}`;
  await sql`UPDATE inventory_balance SET on_hand_qty_boxes = ${b} WHERE lot_id = ${LOT_B}`;
};

before(async () => {
  await resetSchema();
  await seedTenant();
  await sql.unsafe(`
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','P1');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${V}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('a3333333-3333-3333-3333-333333333333','${T}','W','W1','main');
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES
      ('${LOT_A}','${T}','${V}','a3333333-3333-3333-3333-333333333333'),
      ('${LOT_B}','${T}','${V}','a3333333-3333-3333-3333-333333333333');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT_A}',0), ('${T}','${LOT_B}',0);
    CREATE FUNCTION test_widen_race() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_sleep(0.05); RETURN NEW; END $$;
    CREATE TRIGGER test_widen_race BEFORE INSERT ON reservation
      FOR EACH ROW EXECUTE FUNCTION test_widen_race();
  `);
});

const base = { tenantId: T, agentAccountId: AG, ttlHours: 24 };

test("رقابت روی یک lot: ۲۰ رزرو موازی ۱۰ کارتنی روی موجودی ۳۰ → دقیقاً ۳ موفق، بدون oversell", async () => {
  await setStock(30, 0);
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      reserve({ ...base, idempotencyKey: `single-${i}`, items: [{ lotId: LOT_A, quantityBoxes: 10 }] })),
  );
  assert.equal(results.filter((r) => r.ok).length, 3);
  assert.equal(await held(LOT_A), 30, "held نباید از on_hand بیشتر شود");
  const [view] = await sql<{ available_qty_boxes: number }[]>`
    SELECT available_qty_boxes FROM v_lot_availability WHERE lot_id = ${LOT_A}`;
  assert.equal(view.available_qty_boxes, 0);
});

test("رقابت چند lot با ترتیب مخالف اقلام: بدون deadlock و all-or-nothing", async () => {
  await setStock(50, 30);
  // سبدها اقلام را با ترتیب مخالف می‌فرستند؛ قفل ORDER BY lot_id نباید deadlock بدهد (Promise.all با 40P01 رد می‌شود).
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => {
      const a = { lotId: LOT_A, quantityBoxes: 10 }, b = { lotId: LOT_B, quantityBoxes: 10 };
      return reserve({ ...base, idempotencyKey: `multi-${i}`, items: i % 2 ? [a, b] : [b, a] });
    }),
  );
  assert.equal(results.filter((r) => r.ok).length, 3, "lot B با موجودی ۳۰ سقف است");
  assert.equal(await held(LOT_B), 30);
  assert.equal(await held(LOT_A), 30, "رزروِ ردشده نباید روی lot A چیزی نگه دارد");
});
