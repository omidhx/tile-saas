/**
 * داده‌ی نمایشیِ محیطِ توسعه: داده‌ی پایه از `db/seed-dev.sql` + یک چرخه‌ی کاملِ سفارش.
 *
 * اجرا: npm --prefix web run seed:dev
 *
 * چرا چرخه با SQL ساخته نمی‌شود: هر حرکتِ موجودی باید هم‌زمان `inventory_balance`
 * و `inventory_transaction` را بنویسد. اگر این‌جا دستی INSERT می‌زدم، اولین چیزی که
 * گزارشِ تطبیق (`/staff/ledger`) نشان می‌داد **ناترازی** بود — یعنی داده‌ی دمو دقیقاً
 * همان چیزی را می‌شکست که آن صفحه برای گرفتنش ساخته شده. پس همان توابعِ سرویسِ واقعی
 * صدا زده می‌شوند؛ دمو از همان مسیری می‌آید که کاربر می‌آید.
 */
import { readFileSync } from "node:fs";
import { sql } from "../src/db/client";
import { reserve } from "../src/db/reservations";
import { approveReservation } from "../src/db/salesRequests";
import { createDispatchFromRequest, setDispatchStatus } from "../src/db/dispatches";

const T = "11111111-1111-1111-1111-111111111111";
const U_STAFF = "55555555-5555-5555-5555-555555555556";
const AG = "a5555555-5555-5555-5555-555555555555";
const LOT_GRANITE = "a4444444-4444-4444-4444-444444444444";
const LOT_WHITE = "a4444444-4444-4444-4444-444444444445";
const LOT_GRANITE_YAZD = "a4444444-4444-4444-4444-444444444446"; // همان گرانیت، انبار دوم

/** اگر هر مرحله شکست بخورد باید بلند فریاد بزند، نه اینکه دموی نصفه بسازد. */
function must<T extends { ok: boolean }>(r: T, step: string): T & { ok: true } {
  if (!r.ok) throw new Error(`${step} شکست خورد: ${JSON.stringify(r)}`);
  return r as T & { ok: true };
}

async function main() {
  // این اسکریپت `TRUNCATE tenant CASCADE` می‌زند — یعنی همه‌چیز.
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed:dev روی production اجرا نمی‌شود (TRUNCATE tenant CASCADE).");
  }

  // postgres.js تراکنشِ صریح روی pool را رد می‌کند (UNSAFE_TRANSACTION)
  const load = (f: string) =>
    readFileSync(new URL(`../../db/${f}`, import.meta.url), "utf8")
      .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");

  // schema از نو ساخته می‌شود. `CREATE TABLE`های schema.sql بدونِ IF NOT EXISTS‌اند،
  // پس اجرای دوباره روی DBِ موجود شکست می‌خورد — و بدترین حالتش این بود که seed
  // روی schemaی قدیمی اجرا شود و ستون‌های تازه بی‌سروصدا غایب بمانند.
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await sql.unsafe(load("schema.sql"));
  console.log("✓ schema از db/schema.sql");

  await sql.unsafe(load("seed-dev.sql"));
  console.log("✓ داده‌ی پایه (کارخانه، کاربران، کالا، موجودی، قیمت)");

  // سفارش ۱ — چرخه‌ی کامل تا بارگیری: هم «تعهد» دارد هم «تحویلِ فیزیکی»
  const r1 = must(await reserve({
    tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "seed-dev-1",
    items: [{ lotId: LOT_GRANITE, quantityBoxes: 120 }],
  }), "رزروِ ۱");
  const a1 = must(await approveReservation({
    tenantId: T, reservationId: r1.reservationId, actorUserId: U_STAFF,
  }), "تأییدِ ۱");
  const d1 = must(await createDispatchFromRequest({
    tenantId: T, salesRequestId: a1.salesRequestId, createdByUserId: U_STAFF, dispatchCode: "D-1404-001",
  }), "حواله‌ی ۱");
  await setDispatchStatus({ tenantId: T, dispatchId: d1.dispatchIds[0], toStatus: "ready_for_loading", actorUserId: U_STAFF });
  await setDispatchStatus({ tenantId: T, dispatchId: d1.dispatchIds[0], toStatus: "loaded", actorUserId: U_STAFF });
  console.log("✓ سفارش ۱: ۱۲۰ کارتن گرانیت — تأیید و بارگیری شد (با تخفیفِ پله‌ی ۸٪)");

  // سفارش ۲ — تأییدشده ولی بارگیری‌نشده: عمداً، تا در گزارش «ارزشِ تعهد» و
  // «کارتنِ بارگیری‌شده» دو عددِ متفاوت باشند و جدا بودنشان دیده شود.
  const r2 = must(await reserve({
    tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "seed-dev-2",
    items: [{ lotId: LOT_GRANITE, quantityBoxes: 60 }],
  }), "رزروِ ۲");
  must(await approveReservation({
    tenantId: T, reservationId: r2.reservationId, actorUserId: U_STAFF,
  }), "تأییدِ ۲");
  console.log("✓ سفارش ۲: ۶۰ کارتن گرانیت — تأییدشده، هنوز بارگیری نشده");

  // سفارش ۳ — زیرِ سقفِ ۲۰۰ میلیون: باید **خودکار** تأیید شود، بدون دخالتِ پشتیبان.
  // ۲۵ کارتن × ۴٬۲۰۰٬۰۰۰ = ۱۰۵٬۰۰۰٬۰۰۰
  const r3 = must(await reserve({
    tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "seed-dev-3",
    items: [{ lotId: LOT_WHITE, quantityBoxes: 25 }],
  }), "رزروِ ۳");
  if (!r3.autoApproved) throw new Error("سفارش ۳ باید خودکار تأیید می‌شد — سقف اعمال نشد.");
  console.log(`✓ سفارش ۳: ۲۵ کارتن کاشی سفید — تأییدِ خودکار (${r3.autoApproved.orderValue.toLocaleString("fa-IR")} ریال، زیر سقف)`);

  // سفارش ۴ — بالای سقف: باید در صفِ تأییدِ پشتیبان بماند، تا هر دو مسیر در دمو دیده شود.
  // ۳۰ کارتن × ۸٬۵۰۰٬۰۰۰ = ۲۵۵٬۰۰۰٬۰۰۰ (بالای ۲۰۰ میلیون، و زیر پله‌ی تخفیفِ ۵۰ کارتن)
  const r4 = must(await reserve({
    tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "seed-dev-4",
    items: [{ lotId: LOT_GRANITE, quantityBoxes: 30 }],
  }), "رزروِ ۴");
  if (r4.autoApproved) throw new Error("سفارش ۴ نباید خودکار تأیید می‌شد — بالای سقف است.");
  console.log("✓ سفارش ۴: ۳۰ کارتن گرانیت — بالای سقف، در انتظارِ تأییدِ پشتیبان");

  // سفارش ۵ — از **دو انبار**: باید خودکار به دو حواله تقسیم شود، چون یک کامیون
  // نمی‌تواند از دو انبار بار بزند.
  const r5 = must(await reserve({
    tenantId: T, agentAccountId: AG, ttlHours: 24, idempotencyKey: "seed-dev-5",
    items: [{ lotId: LOT_GRANITE, quantityBoxes: 20 }, { lotId: LOT_GRANITE_YAZD, quantityBoxes: 14 }],
  }), "رزروِ ۵");
  const a5 = must(await approveReservation({
    tenantId: T, reservationId: r5.reservationId, actorUserId: U_STAFF,
  }), "تأییدِ ۵");
  const d5 = must(await createDispatchFromRequest({
    tenantId: T, salesRequestId: a5.salesRequestId, createdByUserId: U_STAFF, dispatchCode: "D-1404-002",
  }), "حواله‌ی ۵");
  if (d5.dispatchIds.length !== 2)
    throw new Error(`سفارشِ دوانباره باید دو حواله می‌ساخت، ${d5.dispatchIds.length} ساخت.`);
  console.log("✓ سفارش ۵: ۲۰ کارتن مرکزی + ۱۴ کارتن یزد — به دو حواله تقسیم شد");

  // اگر این تراز نباشد، دمو همان باگی را دارد که /staff/ledger برای گرفتنش هست
  const [drift] = await sql<{ bad: number }[]>`
    SELECT count(*)::int AS bad FROM (
      SELECT b.lot_id
      FROM inventory_balance b
      LEFT JOIN inventory_transaction t ON t.lot_id = b.lot_id
      WHERE b.tenant_id = ${T}
      GROUP BY b.lot_id, b.on_hand_qty_boxes, b.allocated_qty_boxes
      HAVING COALESCE(SUM(t.on_hand_delta_boxes), 0) <> b.on_hand_qty_boxes
          OR COALESCE(SUM(t.allocated_delta_boxes), 0) <> b.allocated_qty_boxes
    ) x`;
  if (drift.bad > 0) throw new Error(`لجر ناتراز است (${drift.bad} lot) — دمو ساخته نشد.`);

  console.log("\n✓ لجر تراز است.");
  console.log("ورود:  09120000001 / pass1234  (پشتیبان)");
  console.log("       09120000000 / pass1234  (نماینده)");
  await sql.end();
}

main().catch(async (e) => {
  console.error("✗", e.message);
  await sql.end();
  process.exit(1);
});
