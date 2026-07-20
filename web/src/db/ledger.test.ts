import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { applySnapshot } from "./imports";
import { reserve } from "./reservations";
import { approveReservation } from "./salesRequests";
import { createDispatchFromRequest, setDispatchStatus } from "./dispatches";
import { listMovements, findDrift } from "./ledger";

const T = "11111111-1111-1111-1111-111111111111";
const U = "a8888888-8888-8888-8888-888888888888";
const AG = "a5555555-5555-5555-5555-555555555555";
const VAR = "a2222222-2222-2222-2222-222222222222";
const WH = "a3333333-3333-3333-3333-333333333333";

before(async () => {
  await resetSchema();
  // عمداً هیچ inventory_balance دستی seed نمی‌کنیم — همه‌ی موجودی از مسیر import می‌آید،
  // چون تستِ اصلی این است که «هر تغییرِ موجودی لجر دارد».
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','0910','x');
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','GB','گرانیت');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${VAR}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES ('${WH}','${T}','W','W1','main');
  `);
});
after(async () => { await sql.end(); });

test("کلِ زنجیره (import→رزرو→تأیید→بارگیری) لجرِ کاملاً تراز می‌سازد", async () => {
  // ۱. ورود موجودی
  const imp = await applySnapshot({
    tenantId: T, uploaderUserId: U, idempotencyKey: "led-1",
    scope: { type: "warehouse", warehouseId: WH },
    rows: [{ sku: "S1", warehouseCode: "W1", batchNumber: "B1", onHand: 100 }],
  });
  assert.equal(imp.applied, 1);
  const [lot] = await sql<{ id: string }[]>`SELECT id FROM inventory_lot WHERE tenant_id = ${T}`;

  // ۲. رزرو → ۳. تأیید → ۴. حواله → ۵. بارگیری
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "led-r1", items: [{ lotId: lot.id, quantityBoxes: 30 }] });
  const a = await approveReservation({ tenantId: T, reservationId: r.ok ? r.reservationId : "", actorUserId: U });
  const d = await createDispatchFromRequest({ tenantId: T, salesRequestId: a.ok ? a.salesRequestId : "", createdByUserId: U, dispatchCode: "D-L1" });
  const did = d.ok ? d.dispatchIds[0] : "";
  await setDispatchStatus({ tenantId: T, dispatchId: did, toStatus: "ready_for_loading", actorUserId: U });
  await setDispatchStatus({ tenantId: T, dispatchId: did, toStatus: "loaded", actorUserId: U });

  // موجودی نهایی: 100 وارد، 30 بارگیری → 70
  const [bal] = await sql<{ on_hand: number; allocated: number }[]>`
    SELECT on_hand_qty_boxes AS on_hand, allocated_qty_boxes AS allocated FROM inventory_balance WHERE lot_id = ${lot.id}`;
  assert.equal(Number(bal.on_hand), 70);
  assert.equal(Number(bal.allocated), 0);

  // مهم‌ترین assert: لجر با موجودی می‌خواند — یعنی هیچ مسیری موجودی را بدون ثبت عوض نکرده
  // (طولِ نتیجه چک می‌شود نه deepEqual: postgres.js زیرکلاسِ Result برمی‌گرداند نه آرایه‌ی ساده)
  assert.equal((await findDrift(T)).length, 0, "بعد از کلِ زنجیره نباید هیچ ناترازی باشد");

  const moves = await listMovements({ tenantId: T });
  const types = moves.map((m) => m.type);
  assert.ok(types.includes("import_snapshot"), "ورود اکسل ثبت شده");
  assert.ok(types.includes("reservation_convert"), "تأیید ثبت شده");
  assert.ok(types.includes("dispatch_load"), "بارگیری ثبت شده");
});

test("ناترازی را می‌گیرد: UPDATE دستی روی موجودی بدون لجر", async () => {
  const [lot] = await sql<{ id: string }[]>`SELECT id FROM inventory_lot WHERE tenant_id = ${T}`;
  // شبیه‌سازیِ دست‌کاریِ مستقیمِ دیتابیس (کاری که لجر برای گرفتنش وجود دارد)
  await sql`UPDATE inventory_balance SET on_hand_qty_boxes = on_hand_qty_boxes + 5 WHERE lot_id = ${lot.id}`;

  const drift = await findDrift(T);
  assert.equal(drift.length, 1, "باید ۱ Lot ناتراز پیدا کند");
  assert.equal(drift[0].onHand - drift[0].ledgerOnHand, 5, "اختلاف دقیقاً ۵ است");

  await sql`UPDATE inventory_balance SET on_hand_qty_boxes = on_hand_qty_boxes - 5 WHERE lot_id = ${lot.id}`;
  assert.equal((await findDrift(T)).length, 0, "بعد از برگرداندن، دوباره تراز");
});
