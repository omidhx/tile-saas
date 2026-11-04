import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { reserve, cancelReservation } from "./reservations";
import { joinWaitlist, leaveWaitlist, listMyWaitlist } from "./waitlist";
import { expireDueReservations } from "./expiry";

/**
 * صف انتظار. چیزی که تست‌ها باید ثابت کنند «کار می‌کند» نیست — **منصفانه است**:
 * نفرِ اولِ صف قبل از نفرِ دوم و قبل از رهگذر موجودی را می‌گیرد.
 */

const T = "11111111-1111-1111-1111-111111111111";
const U = "a8888888-8888-8888-8888-888888888888";
const A1 = "a5555555-5555-5555-5555-555555555551"; // اول صف
const A2 = "a5555555-5555-5555-5555-555555555552"; // دوم صف
const HOG = "a5555555-5555-5555-5555-555555555553"; // کسی که موجودی را گرفته
const WH = "a3333333-3333-3333-3333-333333333333";
const V = "a2222222-2222-2222-2222-222222222222";
const LOT = "a4444444-4444-4444-4444-444444444444";

let seq = 0;
const key = () => `wl-${++seq}`;

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug,default_reservation_ttl_hours) VALUES ('${T}','A','a',24);
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','0910','x');
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES
      ('${A1}','${T}','اولی','AG1'), ('${A2}','${T}','دومی','AG2'), ('${HOG}','${T}','گیرنده','AG3');
    INSERT INTO tenant_membership (tenant_id,user_id,role) VALUES ('${T}','${U}','agent');
    INSERT INTO agent_account_user (tenant_id,agent_account_id,user_id,role) VALUES ('${T}','${A1}','${U}','op');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','W','W1','main');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P','کالا');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${V}','${T}','a1111111-1111-1111-1111-111111111111','S');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES ('${LOT}','${T}','${V}','${WH}');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES ('${T}','${LOT}',100);
  `);
});
after(async () => { await sql.end(); });

// هر تست از وضعیتِ تمیز: بدون رزرو، بدون صف، موجودی کامل
beforeEach(async () => {
  await sql`DELETE FROM waitlist_entry WHERE tenant_id = ${T}`;
  await sql`DELETE FROM notification_outbox WHERE tenant_id = ${T}`;
  await sql`DELETE FROM reservation_item WHERE tenant_id = ${T}`;
  await sql`DELETE FROM reservation WHERE tenant_id = ${T}`;
});

const available = async () => {
  const [r] = await sql<{ n: number }[]>`SELECT available_qty_boxes AS n FROM v_lot_availability WHERE lot_id = ${LOT}`;
  return r.n;
};
const activeResvOf = async (agent: string) => {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM reservation WHERE tenant_id = ${T} AND agent_account_id = ${agent} AND status = 'active'`;
  return rows.map((r) => r.id);
};

test("لغو رزرو → نفرِ اولِ صف بلافاصله رزرو می‌گیرد، در همان تراکنش", async () => {
  const hog = await reserve({ tenantId: T, agentAccountId: HOG, ttlHours: 24, idempotencyKey: key(), items: [{ lotId: LOT, quantityBoxes: 100 }] });
  assert.ok(hog.ok);
  assert.equal(await available(), 0, "همه‌ی موجودی گرفته شده");

  await joinWaitlist({ tenantId: T, agentAccountId: A1, variantId: V, quantityBoxes: 40 });

  await cancelReservation({ tenantId: T, reservationId: hog.reservationId, actorUserId: U });

  assert.equal((await activeResvOf(A1)).length, 1, "نفرِ اولِ صف باید رزرو گرفته باشد");
  assert.equal(await available(), 60, "۴۰ کارتن به صف رفت، ۶۰ آزاد ماند");
  const [w] = await sql`SELECT * FROM waitlist_entry WHERE tenant_id = ${T}`;
  assert.equal(w, undefined, "نوبت پس از پیشنهاد برداشته می‌شود");
});

test("ترتیبِ صف رعایت می‌شود — نفرِ دوم بعد از اولی", async () => {
  const hog = await reserve({ tenantId: T, agentAccountId: HOG, ttlHours: 24, idempotencyKey: key(), items: [{ lotId: LOT, quantityBoxes: 100 }] });
  assert.ok(hog.ok);

  await joinWaitlist({ tenantId: T, agentAccountId: A1, variantId: V, quantityBoxes: 30 });
  await joinWaitlist({ tenantId: T, agentAccountId: A2, variantId: V, quantityBoxes: 30 });

  await cancelReservation({ tenantId: T, reservationId: hog.reservationId, actorUserId: U });

  assert.equal((await activeResvOf(A1)).length, 1, "اولی");
  assert.equal((await activeResvOf(A2)).length, 1, "دومی هم چون موجودی کفاف داد");
  assert.equal(await available(), 40);
});

/** موجودی را با دو رزروِ جدا پر می‌کند تا بشود فقط بخشی را آزاد کرد. */
const holdAll = async (freeable: number) => {
  const keep = await reserve({ tenantId: T, agentAccountId: HOG, ttlHours: 24, idempotencyKey: key(), items: [{ lotId: LOT, quantityBoxes: 100 - freeable }] });
  const drop = await reserve({ tenantId: T, agentAccountId: HOG, ttlHours: 24, idempotencyKey: key(), items: [{ lotId: LOT, quantityBoxes: freeable }] });
  assert.ok(keep.ok && drop.ok);
  return drop.reservationId;
};

test("موجودیِ ناکافی برای نفرِ اول → صف متوقف می‌شود، نه اینکه از رویش بپرد", async () => {
  const drop = await holdAll(50); // فقط ۵۰ آزاد می‌شود
  await joinWaitlist({ tenantId: T, agentAccountId: A1, variantId: V, quantityBoxes: 90 });
  await joinWaitlist({ tenantId: T, agentAccountId: A2, variantId: V, quantityBoxes: 10 });

  await cancelReservation({ tenantId: T, reservationId: drop, actorUserId: U });

  assert.equal((await activeResvOf(A1)).length, 0, "اولی جا نشد (۹۰ > ۵۰)");
  assert.equal((await activeResvOf(A2)).length, 0,
    "دومی هم نباید بگیرد — وگرنه هرکس کم سفارش دهد از صف جلو می‌زند و نوبت بی‌معنا می‌شود");
  const rows = await sql`SELECT * FROM waitlist_entry WHERE tenant_id = ${T}`;
  assert.equal(rows.length, 2, "هر دو نوبت سرِ جایشان می‌مانند");
});

test("all-or-nothing: نوبت با نصفِ سفارش سوزانده نمی‌شود", async () => {
  const drop = await holdAll(30);
  await joinWaitlist({ tenantId: T, agentAccountId: A1, variantId: V, quantityBoxes: 80 });

  await cancelReservation({ tenantId: T, reservationId: drop, actorUserId: U });

  assert.equal((await activeResvOf(A1)).length, 0, "۳۰ از ۸۰ یعنی هیچ — نه رزروِ ۳۰تایی");
  assert.equal(await available(), 30, "موجودی دست‌نخورده آزاد ماند");
});

test("پیشنهادِ صف هرگز خودکار تأیید نمی‌شود، حتی زیرِ سقف", async () => {
  // سقفِ سخاوتمند + قیمت، یعنی اگر گارد نبود قطعاً خودکار تأیید می‌شد
  await sql`UPDATE tenant SET auto_approve_limit = 999999999999 WHERE id = ${T}`;
  await sql`INSERT INTO price_list (id,tenant_id,name) VALUES ('aaaa1111-1111-1111-1111-111111111111',${T},'L')
            ON CONFLICT DO NOTHING`;
  await sql`UPDATE agent_account SET price_list_id = 'aaaa1111-1111-1111-1111-111111111111' WHERE id = ${A1}`;
  await sql`INSERT INTO price_list_item (tenant_id,price_list_id,variant_id,price)
            VALUES (${T},'aaaa1111-1111-1111-1111-111111111111',${V},1000) ON CONFLICT DO NOTHING`;

  const hog = await reserve({ tenantId: T, agentAccountId: HOG, ttlHours: 24, idempotencyKey: key(), items: [{ lotId: LOT, quantityBoxes: 100 }] });
  assert.ok(hog.ok);
  await joinWaitlist({ tenantId: T, agentAccountId: A1, variantId: V, quantityBoxes: 10 });
  await cancelReservation({ tenantId: T, reservationId: hog.reservationId, actorUserId: U });

  const [resv] = await sql<{ status: string }[]>`
    SELECT status FROM reservation WHERE tenant_id = ${T} AND agent_account_id = ${A1}`;
  assert.equal(resv.status, "active",
    "نماینده در آن لحظه حاضر نیست — تعهدِ پول نباید بدونِ او انجام شود");
  const reqs = await sql`SELECT id FROM sales_request WHERE tenant_id = ${T}`;
  assert.equal(reqs.length, 0, "هیچ سفارشی نباید ساخته شده باشد");

  await sql`UPDATE tenant SET auto_approve_limit = NULL WHERE id = ${T}`;
});

test("انقضا هم صف را جلو می‌برد (worker)", async () => {
  const hog = await reserve({ tenantId: T, agentAccountId: HOG, ttlHours: 24, idempotencyKey: key(), items: [{ lotId: LOT, quantityBoxes: 100 }] });
  assert.ok(hog.ok);
  await joinWaitlist({ tenantId: T, agentAccountId: A1, variantId: V, quantityBoxes: 25 });

  // به گذشته می‌بریمش (created_at هم، چون CHECK می‌خواهد expires_at > created_at)
  await sql`UPDATE reservation SET created_at = now() - interval '48 hours', expires_at = now() - interval '1 hour'
            WHERE id = ${hog.reservationId}`;

  const res = await expireDueReservations();
  assert.ok(res.expired > 0, "رزروِ منقضی باید دیده شود");
  assert.equal(res.offers, 1, "و صف باید یک پیشنهاد بسازد");
  assert.equal((await activeResvOf(A1)).length, 1);
});

test("پیامِ پیشنهاد در همان تراکنش صف می‌شود (Outbox)", async () => {
  const hog = await reserve({ tenantId: T, agentAccountId: HOG, ttlHours: 24, idempotencyKey: key(), items: [{ lotId: LOT, quantityBoxes: 100 }] });
  assert.ok(hog.ok);
  await joinWaitlist({ tenantId: T, agentAccountId: A1, variantId: V, quantityBoxes: 20 });
  await cancelReservation({ tenantId: T, reservationId: hog.reservationId, actorUserId: U });

  const [msg] = await sql<{ payload: { type: string; qty: number } }[]>`
    SELECT payload FROM notification_outbox WHERE tenant_id = ${T}`;
  assert.equal(msg.payload.type, "waitlist_offer");
  assert.equal(msg.payload.qty, 20);
});

test("درخواستِ دوباره نوبت را جلو نمی‌اندازد — فقط تعداد را عوض می‌کند", async () => {
  await joinWaitlist({ tenantId: T, agentAccountId: A1, variantId: V, quantityBoxes: 10 });
  await new Promise((r) => setTimeout(r, 10));
  await joinWaitlist({ tenantId: T, agentAccountId: A2, variantId: V, quantityBoxes: 10 });
  // اولی دوباره درخواست می‌دهد تا جلو بیفتد
  await joinWaitlist({ tenantId: T, agentAccountId: A1, variantId: V, quantityBoxes: 15 });

  const mine = await listMyWaitlist({ tenantId: T, agentAccountId: A1 });
  assert.equal(mine[0].position, 1, "هنوز نفرِ اول است، ولی نه به‌خاطرِ کلیکِ دوباره");
  assert.equal(mine[0].quantityBoxes, 15, "تعداد به‌روز شد");
  const second = await listMyWaitlist({ tenantId: T, agentAccountId: A2 });
  assert.equal(second[0].position, 2, "دومی جایگاهش را از دست نداد");
});

test("خروج از صف نوبت را حذف می‌کند", async () => {
  await joinWaitlist({ tenantId: T, agentAccountId: A1, variantId: V, quantityBoxes: 5 });
  await leaveWaitlist({ tenantId: T, agentAccountId: A1, variantId: V });
  assert.equal((await listMyWaitlist({ tenantId: T, agentAccountId: A1 })).length, 0);
});
