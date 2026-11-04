import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { withTenant } from "./client";
import { decideAutoApproval } from "./autoApprove";
import { approveReservationIn } from "./salesRequests";
import { advanceWaitlist } from "./waitlist";
import { resolvePrices } from "./pricing";

export type CancelResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_active" };

/**
 * لغو رزرو توسط نماینده یا پشتیبان (spec بخش ۶، state machine: active → cancelled).
 * بدون این، نماینده‌ای که اشتباهی ۳۰۰ کارتن رزرو کرده تا پایان TTL موجودی را قفل می‌کند.
 *
 * نیازی به دست‌زدن به موجودی نیست: `held` فقط رزروهای `active` را می‌شمارد، پس با
 * همین یک UPDATE، موجودی **بلافاصله** آزاد می‌شود — همان دلیلی که held را محاسباتی نگه داشتیم.
 * `agentAccountId` وقتی داده شود یعنی نماینده دارد لغو می‌کند → فقط رزروِ خودش.
 */
export async function cancelReservation(params: {
  tenantId: string; reservationId: string; actorUserId: string; agentAccountId?: string;
}): Promise<CancelResult> {
  const { tenantId, reservationId, actorUserId, agentAccountId } = params;
  return withTenant(tenantId, async (tx) => {
    // guard اتمیک: فقط active. دو لغوِ هم‌زمان → فقط یکی ردیف می‌گیرد.
    const done = await tx<{ id: string }[]>`
      UPDATE reservation SET status = 'cancelled'
      WHERE id = ${reservationId} AND tenant_id = ${tenantId} AND status = 'active'
        AND ${agentAccountId ? tx`agent_account_id = ${agentAccountId}` : tx`TRUE`}
      RETURNING id`;
    if (done.length === 0) {
      // تفکیک «وجود ندارد/مالِ تو نیست» از «دیگر active نیست»
      const [exists] = await tx<{ status: string }[]>`
        SELECT status FROM reservation
        WHERE id = ${reservationId} AND tenant_id = ${tenantId}
          AND ${agentAccountId ? tx`agent_account_id = ${agentAccountId}` : tx`TRUE`}`;
      return { ok: false, reason: exists ? "not_active" : "not_found" };
    }

    // لجرِ audit: موجودی عددی تغییر نکرد (held محاسباتی است)، ولی رد پا لازم است
    const items = await tx<{ lot_id: string; quantity_boxes: number }[]>`
      SELECT lot_id, quantity_boxes FROM reservation_item WHERE reservation_id = ${reservationId}`;
    for (const it of items)
      await tx`
        INSERT INTO inventory_transaction
          (tenant_id, lot_id, transaction_type, reference_type, reference_id, actor_user_id, note)
        VALUES (${tenantId}, ${it.lot_id}, 'reservation_cancel', 'reservation', ${reservationId},
                ${actorUserId}, ${"آزادسازی " + it.quantity_boxes})`;

    // صف انتظار: موجودی همین حالا آزاد شد (held فقط activeها را می‌شمارد)، پس صف باید
    // در **همین تراکنش** جلو برود — وگرنه نفرِ اولِ صف به کسی می‌بازد که صفحه‌اش باز است.
    const variants = await tx<{ variant_id: string }[]>`
      SELECT DISTINCT l.variant_id FROM reservation_item ri
      JOIN inventory_lot l ON l.id = ri.lot_id
      WHERE ri.reservation_id = ${reservationId} AND ri.tenant_id = ${tenantId}`;
    await advanceWaitlist(tx, tenantId, variants.map((v) => v.variant_id));

    return { ok: true };
  });
}

export type ReservationListItem = {
  id: string; status: string; expiresAt: string; agentName: string;
  assignedStaffName: string | null; assignedStaffPhone: string | null;
  items: {
    variantId: string; name: string; code: string; quantityBoxes: number;
    boxesPerPallet: number | null; sqcmPerBox: number;
  }[];
  /** مبلغِ قطعیِ خرید — فقط برای status='converted'، از snapshotِ لحظه‌ی تأیید (sales_request_item). */
  purchaseValue: number | null;
  /** برآوردِ «رزروهای من» برای status='active' با قیمتِ زنده — قطعی نیست، هنوز تأیید نشده. */
  estimatedValue: number | null;
};

/**
 * فهرستِ رزروها — با agentAccountId → «رزروهای من» (نماینده)، بدونِ آن → صفِ تأیید (staff).
 * هرگز فقط به status تکیه نکن: worker انقضا ممکنه هنوز نرسیده باشه، پس وضعیتِ مؤثر
 * همین‌جا مشتق می‌شه (هم‌راستا با تعریفِ held). spec ۱۴ / بخش ۵.۳.
 */
export async function listReservations(params: {
  tenantId: string; agentAccountId?: string;
}): Promise<ReservationListItem[]> {
  const { tenantId, agentAccountId } = params;
  const staffView = !agentAccountId;
  const rawRows = await withTenant(tenantId, (tx) =>
    // purchaseValue::bigint از postgres.js رشته برمی‌گردد (نه number) — پایینِ همین تابع Number می‌شود
    tx<(Omit<ReservationListItem, "estimatedValue" | "purchaseValue"> & { purchaseValue: string | null })[]>`
      SELECT r.id,
        CASE WHEN r.status = 'active' AND r.expires_at <= now() THEN 'expired' ELSE r.status END AS status,
        r.expires_at AS "expiresAt", aa.legal_name AS "agentName",
        -- v5: پشتیبانِ ثابتِ همین نمایندگی — هم صفِ staff (بداند سفارش دستِ کیست)
        -- هم صفحه‌ی نماینده («این را چه کسی پیگیری می‌کند») از همین یک ستون می‌خوانند.
        su.full_name AS "assignedStaffName", su.phone AS "assignedStaffPhone",
        COALESCE(json_agg(json_build_object(
          'variantId', pv.id, 'name', p.name, 'code', p.code, 'quantityBoxes', ri.quantity_boxes,
          -- برای پنلِ پشتیبان: معادلِ پالت/مترمربع کنارِ عددِ کارتن (spec تبدیلِ واحد).
          -- override رویِ خودِ Lot اگر باشد ارجح است، هم‌راستا با کوئریِ /api/lots.
          'boxesPerPallet', COALESCE(l.boxes_per_pallet_override, pv.boxes_per_pallet),
          'sqcmPerBox', pv.sqcm_per_box
        )) FILTER (WHERE ri.id IS NOT NULL), '[]') AS items,
        -- v11 «مبلغِ خرید به حروف»: برای رزروِ تبدیل‌شده، همان مبلغِ قطعیِ سفارش (نه تخمین) —
        -- snapshotِ sales_request_item، دقیقاً همان فرمولِ reports.ts (پله‌ی تخفیفِ حجمی کم شده).
        sr_value."purchaseValue"
      FROM reservation r
      JOIN agent_account aa ON aa.id = r.agent_account_id
      LEFT JOIN app_user su ON su.id = aa.assigned_staff_user_id
      LEFT JOIN reservation_item ri ON ri.reservation_id = r.id
      LEFT JOIN inventory_lot l ON l.id = ri.lot_id
      LEFT JOIN product_variant pv ON pv.id = l.variant_id
      LEFT JOIN product p ON p.id = pv.product_id
      LEFT JOIN LATERAL (
        SELECT SUM(sri.unit_price_applied * sri.requested_qty_boxes - COALESCE(sri.discount_amount, 0))::bigint AS "purchaseValue"
        FROM sales_request sr
        JOIN sales_request_item sri ON sri.request_id = sr.id AND sri.tenant_id = sr.tenant_id
        WHERE sr.reservation_id = r.id AND sr.tenant_id = r.tenant_id
      ) sr_value ON TRUE
      WHERE r.tenant_id = ${tenantId}
        AND ${staffView
            // صفِ تأیید: فقط رزروِ واقعاً زنده — منقضی نباید به‌عنوان «در انتظار تأیید» دیده شه
            ? tx`r.status = 'active' AND r.expires_at > now()`
            : tx`r.agent_account_id = ${agentAccountId}`}
      GROUP BY r.id, aa.legal_name, su.full_name, su.phone, sr_value."purchaseValue"
      -- صفِ تأیید یعنی صفِ کار: چیزی که زودتر منقضی می‌شود باید اول دیده شود،
      -- وگرنه رزروِ قدیمی زیرِ رزروهای تازه‌تر گم می‌شود و بدونِ تأیید منقضی می‌شود.
      -- «رزروهای من» (agent view) نیازی به این ترتیب ندارد چون صفِ کار نیست.
      ORDER BY ${staffView ? tx`r.expires_at ASC` : tx`r.created_at DESC`}
      LIMIT 50`,
  );
  const rows = rawRows.map((r) => ({ ...r, purchaseValue: r.purchaseValue == null ? null : Number(r.purchaseValue) }));

  // برآوردِ زنده فقط برای «رزروهای من» (نه صفِ staff) و فقط رزروهای هنوز active —
  // بار اضافه ندارد چون تعدادِ active یک نماینده معمولاً کم است (سقفِ کلی هم ۵۰).
  if (staffView) return rows.map((r) => ({ ...r, estimatedValue: null }));
  return Promise.all(rows.map(async (r) => {
    if (r.status !== "active") return { ...r, estimatedValue: null };
    const qtyByVariant: Record<string, number> = {};
    for (const it of r.items) qtyByVariant[it.variantId] = (qtyByVariant[it.variantId] ?? 0) + it.quantityBoxes;
    const prices = await resolvePrices({ tenantId, agentAccountId: agentAccountId!, variantIds: Object.keys(qtyByVariant), qtyByVariant });
    let estimatedValue = 0, anyPriced = false;
    for (const p of prices.values()) { estimatedValue += p.lineTotal; anyPriced = true; }
    return { ...r, estimatedValue: anyPriced ? estimatedValue : null };
  }));
}

export type ReserveItem = { lotId: string; quantityBoxes: number };
export type ReserveResult =
  | {
      ok: true; reservationId: string; deduped: boolean;
      /** v2 تأیید هیبریدی: اگر زیرِ سقف بود، همین‌جا تأیید شد و سفارش ساخته شد. */
      autoApproved?: { salesRequestId: string; orderValue: number; limitApplied: number };
    }
  | { ok: false; conflict: { lotId: string; requested: number; available: number } }
  | { ok: false; idempotencyMismatch: true };

/**
 * الگوریتم رزرو — پیاده‌سازی مرجعِ بخش ۶ spec. همه‌ی قوانین معماری اینجا هم‌گرا می‌شن:
 *   #۱ held محاسباتی (SUM)، هرگز ستون کش‌شده
 *   #۲ available >= requested اجباری، بدون استثنا
 *   #۳ all-or-nothing (یا کل سبد یا هیچ)
 *   #۴ قفل ORDER BY lot_id (جلوی deadlock)
 * raw SQL عمدیه: مسیر قفل باید دقیق باشه، query-builder اینجا فقط ابهام می‌سازه.
 *
 * برمی‌گردونه: ok:false با conflict یعنی ۴۰۹ (کلاینت پیام «موجودی فعلی: X» می‌سازه).
 */
export async function reserve(params: {
  tenantId: string;
  agentAccountId: string;
  ttlHours: number;
  idempotencyKey: string;
  items: ReserveItem[];
}): Promise<ReserveResult> {
  return withTenant(params.tenantId, (tx) => reserveIn(tx, params));
}

/**
 * همان رزرو، داخلِ تراکنشِ صداکننده — تا صفِ انتظار بتواند در **همان تراکنشی** که
 * موجودی آزاد می‌شود پیشنهاد بسازد. اگر تراکنشِ جدا بود، بینِ آزادسازی و پیشنهاد
 * پنجره‌ای می‌ماند که هرکس صفحه‌اش باز است موجودی را می‌برد و صف بی‌معنا می‌شود.
 */
export async function reserveIn(
  tx: TransactionSql,
  params: {
    tenantId: string;
    agentAccountId: string;
    ttlHours: number;
    idempotencyKey: string;
    items: ReserveItem[];
    /**
     * پیشنهادِ صفِ انتظار نباید خودکار تأیید شود: نماینده در آن لحظه حاضر نیست و
     * درخواستش شاید روزها پیش ثبت شده. تعهدِ پول باید با حضورِ او باشد.
     */
    skipAutoApprove?: boolean;
  },
): Promise<ReserveResult> {
  const { tenantId, agentAccountId, ttlHours, idempotencyKey, items, skipAutoApprove } = params;
  if (items.length === 0) throw new Error("رزرو خالی مجاز نیست");

  // اقلام هم‌lot را جمع و بر اساس lot_id مرتب کن — قفل همیشه ORDER BY lot_id (#۴)
  const byLot = new Map<string, number>();
  for (const it of items) {
    if (!Number.isInteger(it.quantityBoxes) || it.quantityBoxes <= 0)
      throw new Error("تعداد باید عدد صحیح مثبت باشه");
    byLot.set(it.lotId, (byLot.get(it.lotId) ?? 0) + it.quantityBoxes);
  }
  const lotIds = [...byLot.keys()].sort();
  // هشِ payload نرمال‌شده: تشخیصِ «همون کلید، body متفاوت» (lotIds مرتب پس قطعیه)
  const requestHash = createHash("sha256")
    .update(agentAccountId + "|" + lotIds.map((l) => `${l}:${byLot.get(l)}`).join(","))
    .digest("hex");

  {
    // ۱. idempotency: کلید تکراری → رزرو موجود را برگردون (بخش ۶: ۲۰۰ نه ۴۰۹، نه رزرو دوباره)
    const existing = await tx<{ id: string; idempotency_request_hash: string | null }[]>`
      SELECT id, idempotency_request_hash FROM reservation
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${idempotencyKey}`;
    if (existing.length > 0)
      // همون کلید + همون payload → همون رزرو (۲۰۰). کلید تکراری + payload متفاوت → ۴۰۹، نه رزرو بی‌سروصدا
      return existing[0].idempotency_request_hash === requestHash
        ? { ok: true, reservationId: existing[0].id, deduped: true }
        : { ok: false, idempotencyMismatch: true };

    // ۲. قفل balanceها با ORDER BY lot_id FOR UPDATE — این ردیف‌ها تنها mutexِ lotها هستن (#۴)
    const balances = await tx<
      { lot_id: string; on_hand_qty_boxes: number; allocated_qty_boxes: number; blocked_qty_boxes: number }[]
    >`
      SELECT lot_id, on_hand_qty_boxes, allocated_qty_boxes, blocked_qty_boxes
      FROM inventory_balance
      WHERE tenant_id = ${tenantId} AND lot_id IN ${tx(lotIds)}
      ORDER BY lot_id
      FOR UPDATE`;
    if (balances.length !== lotIds.length)
      throw new Error("یک یا چند lot ردیف balance نداره");

    // ۳+۴. held با SUM (پس از قفل، پس consistent)؛ available>=requested برای همه (#۱،#۲،#۳)
    for (const b of balances) {
      const [{ held }] = await tx<{ held: string }[]>`
        SELECT COALESCE(SUM(ri.quantity_boxes), 0) AS held
        FROM reservation_item ri JOIN reservation r ON r.id = ri.reservation_id
        WHERE ri.lot_id = ${b.lot_id} AND r.status = 'active' AND r.expires_at > now()`;
      const available =
        b.on_hand_qty_boxes - Number(held) - b.allocated_qty_boxes - b.blocked_qty_boxes;
      const requested = byLot.get(b.lot_id)!;
      if (available < requested)
        // return (نه throw): چیزی ننوشتیم، commitِ خالی فقط قفل‌ها را آزاد می‌کنه. کل رزرو رد شد (#۳)
        return { ok: false, conflict: { lotId: b.lot_id, requested, available } };
    }

    // ۵. ثبت reservation + itemها
    //    ON CONFLICT DO NOTHING: اگر دو درخواست هم‌زمان با همان idempotencyKey
    //    رسیدند، دومی به‌جای ۵۰۰، ۰ ردیف برمی‌گرداند و ما را مجبور می‌کند
    //    رزروِ موجود را دوباره بخوانیم (dedupe).
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO reservation (tenant_id, agent_account_id, expires_at, idempotency_key, idempotency_request_hash)
      VALUES (${tenantId}, ${agentAccountId}, now() + make_interval(hours => ${ttlHours}), ${idempotencyKey}, ${requestHash})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
      RETURNING id`;

    if (inserted.length === 0) {
      // رقابتِ هم‌زمان: درخواستِ دیگری با همان کلید زودتر INSERT کرد.
      // رزروِ موجود را بخوان و dedupe کن (یا mismatch را برگردان).
      const [existing] = await tx<{ id: string; idempotency_request_hash: string | null }[]>`
        SELECT id, idempotency_request_hash FROM reservation
        WHERE tenant_id = ${tenantId} AND idempotency_key = ${idempotencyKey}`;
      if (existing) {
        return existing.idempotency_request_hash === requestHash
          ? { ok: true, reservationId: existing.id, deduped: true }
          : { ok: false, idempotencyMismatch: true };
      }
      // بسیار نادر: INSERT شکست خورد ولی ردیف هم پیدا نشد (مثلاً rollback هم‌زمان).
      // دوباره با ON CONFLICT تلاش کن — اگر باز هم ۰ ردیف برگرداند، SELECT کن.
      // هرگز INSERT بدون ON CONFLICT نزن چون ممکن است UNIQUE constraint بخورد و 500 بدهد.
      const retryInserted = await tx<{ id: string }[]>`
        INSERT INTO reservation (tenant_id, agent_account_id, expires_at, idempotency_key, idempotency_request_hash)
        VALUES (${tenantId}, ${agentAccountId}, now() + make_interval(hours => ${ttlHours}), ${idempotencyKey}, ${requestHash})
        ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        RETURNING id`;
      if (retryInserted.length > 0) {
        var resvId = retryInserted[0].id;
      } else {
        // هنوز ۰ ردیف — یعنی بین دو INSERT، تراکنش دیگری commit کرده.
        const [retryExisting] = await tx<{ id: string; idempotency_request_hash: string | null }[]>`
          SELECT id, idempotency_request_hash FROM reservation
          WHERE tenant_id = ${tenantId} AND idempotency_key = ${idempotencyKey}`;
        if (retryExisting) {
          return retryExisting.idempotency_request_hash === requestHash
            ? { ok: true, reservationId: retryExisting.id, deduped: true }
            : { ok: false, idempotencyMismatch: true };
        }
        // این نباید رخ دهد —但如果 رخ داد، خطای صریح بده نه 500 تصادفی.
        throw new Error("idempotency: ردیف پیدا نشد بعد از دو INSERT و دو SELECT");
      }
    } else {
      var resvId = inserted[0].id;
    }

    for (const lotId of lotIds)
      await tx`
        INSERT INTO reservation_item (tenant_id, reservation_id, lot_id, quantity_boxes)
        VALUES (${tenantId}, ${resvId}, ${lotId}, ${byLot.get(lotId)!})`;

    // ۶. لجر (hold: on_hand/allocated عوض نمی‌شه چون held محاسباتیه — فقط ردپای audit)
    for (const lotId of lotIds)
      await tx`
        INSERT INTO inventory_transaction
          (tenant_id, lot_id, transaction_type, reference_type, reference_id, note)
        VALUES (${tenantId}, ${lotId}, 'reservation_hold', 'reservation', ${resvId},
                ${"held " + byLot.get(lotId)!})`;

    // ۷. تأیید هیبریدی (v2): اگر ارزشِ سفارش زیرِ سقف بود، همین‌جا و در **همین تراکنش**
    //    تأیید می‌شود. جدا کردنش به تراکنشِ دوم یعنی پنجره‌ای که رزرو هست ولی تأیید نیست،
    //    و شکستِ نیمه‌راه یک رزروِ سرگردان می‌گذاشت. سقفِ تعریف‌نشده یا خطِ بی‌قیمت →
    //    تصمیم «نه» است، پس رفتارِ پیش‌فرض همان تأییدِ دستیِ قبلی می‌ماند.
    const decision = skipAutoApprove
      ? ({ approve: false, reason: "disabled" } as const)
      : await decideAutoApproval(tx, { tenantId, agentAccountId, reservationId: resvId });
    if (decision.approve) {
      const approved = await approveReservationIn(tx, {
        tenantId, reservationId: resvId, actorUserId: null,
        mode: "auto", limitApplied: decision.limitApplied,
      });
      // تأییدِ همین رزروِ تازه‌ساخته نباید شکست بخورد؛ اگر خورد، چیزی که فرض کردیم
      // درست نیست و بهتر است کلِ تراکنش برگردد تا رزروِ نیمه‌تأیید بماند.
      if (!approved.ok) throw new Error(`تأیید خودکار شکست خورد: ${approved.reason}`);
      return {
        ok: true, reservationId: resvId, deduped: false,
        autoApproved: {
          salesRequestId: approved.salesRequestId,
          orderValue: decision.orderValue,
          limitApplied: decision.limitApplied,
        },
      };
    }

    return { ok: true, reservationId: resvId, deduped: false };
  }
}
