import { test, before } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { sql, resetSchema, ALIGN_PALLETS } from "./_testdb";
import { reserve } from "./reservations";
import { approveReservation } from "./salesRequests";
import { createDispatchFromRequest, setDispatchStatus } from "./dispatches";
import { T, U, seedTenantUser } from "./_fixtures";

/**
 * فاز ۴: ساخت و لغوِ حواله.
 *   - `createDispatchFromRequest` درخواست را قفل نمی‌کرد (معلقِ فاز ۱ و E3-F8).
 *   - کدِ خودکارِ حواله MAX+1 بدون قفل بود و ساختِ هم‌زمان 23505 (۵۰۰) می‌داد.
 *   - لغوِ یک حواله از سفارشِ دوانباره کلِ درخواست را لغو می‌کرد (E3-F4).
 */

const AG = "a5555555-5555-5555-5555-555555555555";
const V = "a2222222-2222-2222-2222-222222222222";
const WH_A = "a3333333-3333-3333-3333-33333333333a";
const WH_B = "a3333333-3333-3333-3333-33333333333b";
const LOT_A = "a4444444-4444-4444-4444-44444444444a";
const LOT_B = "a4444444-4444-4444-4444-44444444444b";

let seq = 0;
const key = () => `race-${++seq}`;

before(async () => {
  await resetSchema();
  await seedTenantUser();
  await sql.unsafe(`
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T}','Ag','AG1');
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111111','${T}','P1','کالا');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES ('${V}','${T}','a1111111-1111-1111-1111-111111111111','S1');
    INSERT INTO warehouse (id,tenant_id,name,code,type) VALUES
      ('${WH_A}','${T}','انبار مرکزی','WA','main'), ('${WH_B}','${T}','انبار یزد','WB','regional');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES
      ('${LOT_A}','${T}','${V}','${WH_A}'), ('${LOT_B}','${T}','${V}','${WH_B}');
    INSERT INTO inventory_balance (tenant_id,lot_id,on_hand_qty_boxes) VALUES
      ('${T}','${LOT_A}',1000), ('${T}','${LOT_B}',1000);
  ${ALIGN_PALLETS}`);
});

async function approved(items: { lotId: string; quantityBoxes: number }[]) {
  const r = await reserve({ tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: key(), items });
  assert.ok(r.ok);
  const a = await approveReservation({ tenantId: T, reservationId: r.reservationId, actorUserId: U });
  assert.ok(a.ok);
  return a.salesRequestId;
}

const balance = async (lot: string) => {
  const [b] = await sql<{ allocated: number }[]>`
    SELECT allocated_qty_boxes AS allocated FROM inventory_balance WHERE lot_id = ${lot}`;
  return b.allocated;
};

/** منتظر می‌ماند تا یک اتصالِ دیگر پشتِ قفل گیر کند. */
async function waitForLockWait(atLeast = 1) {
  for (let i = 0; i < 250; i++) {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND usename = 'app_user'`;
    if (n >= atLeast) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`کمتر از ${atLeast} اتصال پشتِ قفل منتظر ماند`);
}

test("فاز ۴: لغوِ هم‌زمان با ساختِ حواله، حواله‌ی زنده روی درخواستِ لغوشده نمی‌سازد", async () => {
  const req = await approved([{ lotId: LOT_A, quantityBoxes: 10 }]);
  const first = await createDispatchFromRequest({ tenantId: T, salesRequestId: req, createdByUserId: U });
  assert.ok(first.ok);
  const before = await balance(LOT_A);

  // اتصالِ جدا نقشِ «لغوِ در حالِ اجرا» را بازی می‌کند و همه‌ی قفل‌هایش را از اول می‌گیرد،
  // تا ترتیب قطعی باشد: ساختِ حواله بعد از خواندنِ درخواست، پشتِ این تراکنش گیر می‌کند.
  const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });
  let release!: () => void, locked!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const isLocked = new Promise<void>((r) => (locked = r));
  const cancel = admin.begin(async (tx) => {
    await tx`LOCK TABLE sales_dispatch IN ACCESS EXCLUSIVE MODE`;
    await tx`SELECT id FROM sales_request WHERE id = ${req} FOR UPDATE`;
    // فقط بعد از هر دو قفل: اگر ساختِ حواله بینِ این دو دستور قفلِ درخواست را بگیرد،
    // خودِ این شبیه‌سازی (که برخلافِ لغوِ واقعی جدول را قفل می‌کند) deadlock می‌سازد.
    locked();
    await gate;
    // همان نوشتن‌هایی که setDispatchStatus(cancelled) روی تنها حواله‌ی درخواست انجام می‌دهد
    await tx`UPDATE sales_dispatch SET status = 'cancelled' WHERE id = ${first.dispatchIds[0]}`;
    await tx`UPDATE inventory_balance SET allocated_qty_boxes = allocated_qty_boxes - 10 WHERE lot_id = ${LOT_A}`;
    await tx`INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, allocated_delta_boxes, reference_type, reference_id)
             VALUES (${T}, ${LOT_A}, 'dispatch_cancel', -10, 'sales_dispatch', ${first.dispatchIds[0]})`;
    await tx`UPDATE sales_request SET status = 'cancelled' WHERE id = ${req}`;
  });

  await isLocked;
  const create = createDispatchFromRequest({ tenantId: T, salesRequestId: req, createdByUserId: U });
  await waitForLockWait();
  release();
  await cancel;
  await admin.end();
  const r = await create;

  assert.deepEqual(r, { ok: false, reason: "request_not_approved" });
  const live = await sql<{ id: string }[]>`
    SELECT id FROM sales_dispatch WHERE sales_request_id = ${req} AND status <> 'cancelled'`;
  assert.equal(live.length, 0, "حواله‌ی زنده روی درخواستِ لغوشده ساخته شد؛ بارگیری‌اش allocatedِ دیگران را می‌خورد");
  assert.equal(await balance(LOT_A), before - 10);
});

test("فاز ۴: ساختِ هم‌زمانِ حواله برای یک درخواست فقط یکی می‌سازد و بقیه already_dispatched می‌گیرند", async () => {
  const req = await approved([{ lotId: LOT_A, quantityBoxes: 5 }]);
  // کدِ صریح و متفاوت (همان سناریوی E3-F8): بدونِ آن، برخوردِ کد تکرار را پنهان می‌کند.
  // قفلِ جدول همه را پشتِ یک دروازه نگه می‌دارد تا هم‌زمانی قطعی باشد، نه شانسی.
  const admin = postgres(process.env.TEST_ADMIN_DATABASE_URL!, { max: 1, onnotice: () => {} });
  let release!: () => void, locked!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const isLocked = new Promise<void>((r) => (locked = r));
  const hold = admin.begin(async (tx) => {
    await tx`LOCK TABLE sales_dispatch IN ACCESS EXCLUSIVE MODE`;
    locked();
    await gate;
  });
  await isLocked;
  const calls = Array.from({ length: 8 }, (_, i) =>
    createDispatchFromRequest({ tenantId: T, salesRequestId: req, createdByUserId: U, dispatchCode: `D-SAME-${i}` }));
  await waitForLockWait(8);
  release();
  await hold;
  await admin.end();
  const results = await Promise.allSettled(calls);
  const thrown = results.filter((r) => r.status === "rejected");
  assert.equal(thrown.length, 0, `خطای خام: ${thrown.map((t) => (t as PromiseRejectedResult).reason?.code).join(",")}`);
  const ok = results.filter((r) => r.status === "fulfilled" && r.value.ok);
  assert.equal(ok.length, 1);
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM sales_dispatch WHERE sales_request_id = ${req} AND status <> 'cancelled'`;
  assert.equal(n, 1);
});

test("فاز ۴: ساختِ هم‌زمانِ حواله برای درخواست‌های مختلف با کدِ خودکار ۵۰۰ نمی‌دهد", async () => {
  const reqs: string[] = [];
  for (let i = 0; i < 8; i++) reqs.push(await approved([{ lotId: LOT_A, quantityBoxes: 1 }]));
  const results = await Promise.allSettled(reqs.map((id) =>
    createDispatchFromRequest({ tenantId: T, salesRequestId: id, createdByUserId: U })));
  const thrown = results.filter((r) => r.status === "rejected");
  assert.equal(thrown.length, 0, `خطای خام (کدِ تکراری): ${thrown.length} از ۸`);
  const codes = await sql<{ dispatch_code: string }[]>`
    SELECT dispatch_code FROM sales_dispatch WHERE sales_request_id IN ${sql(reqs)}`;
  assert.equal(new Set(codes.map((c) => c.dispatch_code)).size, 8);
});

test("فاز ۴: لغوِ یک حواله از سفارشِ دوانباره درخواست را لغو نمی‌کند تا وقتی حواله‌ی زنده‌ای مانده", async () => {
  const req = await approved([{ lotId: LOT_A, quantityBoxes: 20 }, { lotId: LOT_B, quantityBoxes: 15 }]);
  const d = await createDispatchFromRequest({ tenantId: T, salesRequestId: req, createdByUserId: U });
  assert.ok(d.ok && d.dispatchIds.length === 2);
  const [dA, dB] = (await sql<{ id: string; warehouse_id: string }[]>`
    SELECT id, warehouse_id FROM sales_dispatch WHERE id IN ${sql(d.dispatchIds)} ORDER BY dispatch_code`).map((x) => x.id);
  const aBefore = await balance(LOT_A), bBefore = await balance(LOT_B);

  assert.ok((await setDispatchStatus({ tenantId: T, dispatchId: dA, toStatus: "cancelled", actorUserId: U })).ok);
  const status = async () => (await sql<{ status: string }[]>`SELECT status FROM sales_request WHERE id = ${req}`)[0].status;
  assert.equal(await status(), "approved", "حواله‌ی انبارِ دیگر هنوز زنده است؛ درخواست نباید لغو شود");
  assert.equal(await balance(LOT_A), aBefore - 20, "تخصیصِ حواله‌ی لغوشده آزاد می‌شود");
  assert.equal(await balance(LOT_B), bBefore, "تخصیصِ حواله‌ی زنده دست نمی‌خورد");

  // قسمتِ لغوشده دوباره ساخته نمی‌شود: تخصیصش آزاد شده و بارگیری‌اش موجودیِ دیگران را می‌خورد
  const again = await createDispatchFromRequest({ tenantId: T, salesRequestId: req, createdByUserId: U });
  assert.deepEqual(again, { ok: false, reason: "already_dispatched" });

  // حواله‌ی دیگر بارگیری می‌شود و درخواست تأییدشده می‌ماند
  assert.ok((await setDispatchStatus({ tenantId: T, dispatchId: dB, toStatus: "ready_for_loading", actorUserId: U })).ok);
  assert.ok((await setDispatchStatus({ tenantId: T, dispatchId: dB, toStatus: "loaded", actorUserId: U })).ok);
  assert.equal(await status(), "approved");

  // گزارشِ نماینده فقط نیمه‌ی بارگیری‌شده را می‌شمارد: نه ۳۵ (کلِ سفارش)، نه ۰ (درخواستِ لغوشده)
  const { buildReports } = await import("./reports");
  const day = 86_400_000;
  const r = await buildReports({ tenantId: T, from: new Date(Date.now() - day), to: new Date(Date.now() + day), agentAccountId: AG });
  // درخواست‌های دیگرِ همین فایل هیچ سهمِ لغوشده‌ای ندارند، پس کاملشان شمرده می‌شود
  const [{ n }] = await sql<{ n: number }[]>`
    SELECT COALESCE(SUM(sri.requested_qty_boxes), 0)::int AS n FROM sales_request_item sri
    JOIN sales_request sr ON sr.id = sri.request_id
    WHERE sr.agent_account_id = ${AG} AND sr.status IN ('approved','fulfilled') AND sr.id <> ${req}`;
  assert.equal(r.agents[0]?.boxes, n + 15, "سهمِ لغوشده‌ی ۲۰ کارتنی هنوز در گزارش شمرده می‌شود");
});

test("فاز ۴: لغوِ آخرین حواله‌ی زنده درخواست را لغو می‌کند", async () => {
  const req = await approved([{ lotId: LOT_A, quantityBoxes: 3 }, { lotId: LOT_B, quantityBoxes: 3 }]);
  const d = await createDispatchFromRequest({ tenantId: T, salesRequestId: req, createdByUserId: U });
  assert.ok(d.ok);
  for (const id of d.dispatchIds)
    assert.ok((await setDispatchStatus({ tenantId: T, dispatchId: id, toStatus: "cancelled", actorUserId: U })).ok);
  const [{ status }] = await sql<{ status: string }[]>`SELECT status FROM sales_request WHERE id = ${req}`;
  assert.equal(status, "cancelled");
});
