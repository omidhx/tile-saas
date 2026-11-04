import postgres from "postgres";
import { withTenant } from "./client";
import { resolvePricesIn, CURRENCY } from "./pricing";

export type SalesRequestListItem = {
  id: string; status: string; createdAt: string; agentName: string; approvalMode: ApprovalMode;
  assignedStaffName: string | null; assignedStaffPhone: string | null;
  items: { name: string; code: string; qty: number }[];
};

/** فهرستِ درخواست‌ها برای پنل staff (حواله‌سازی) — پیش‌فرض status=approved. */
export async function listSalesRequests(params: {
  tenantId: string; status?: string;
}): Promise<SalesRequestListItem[]> {
  const { tenantId, status = "approved" } = params;
  return withTenant(tenantId, (tx) =>
    tx<SalesRequestListItem[]>`
      SELECT sr.id, sr.status, sr.created_at AS "createdAt", aa.legal_name AS "agentName",
        sr.approval_mode AS "approvalMode",
        -- v5: پشتیبانِ ثابت — حتی وقتی approval_mode='auto' (بدونِ actor انسانی)،
        -- تا هر staffی که صف را می‌بیند بداند این سفارش پورسانتِ کیست.
        su.full_name AS "assignedStaffName", su.phone AS "assignedStaffPhone",
        COALESCE(json_agg(json_build_object(
          'name', p.name, 'code', p.code, 'qty', sri.requested_qty_boxes
        )) FILTER (WHERE sri.id IS NOT NULL), '[]') AS items
      FROM sales_request sr
      JOIN agent_account aa ON aa.id = sr.agent_account_id
      LEFT JOIN app_user su ON su.id = aa.assigned_staff_user_id
      LEFT JOIN sales_request_item sri ON sri.request_id = sr.id
      LEFT JOIN product_variant pv ON pv.id = sri.variant_id
      LEFT JOIN product p ON p.id = pv.product_id
      WHERE sr.tenant_id = ${tenantId} AND sr.status = ${status}
        -- سفارشی که حواله‌ی زنده دارد از صفِ «ساخت حواله» بیرون می‌رود — وگرنه دکمه
        -- برای همیشه می‌ماند و دو کلیک یعنی دو بار ارسالِ همان بار (لغوشده استثناست).
        AND NOT EXISTS (SELECT 1 FROM sales_dispatch sd
                        WHERE sd.tenant_id = sr.tenant_id AND sd.sales_request_id = sr.id
                          AND sd.status <> 'cancelled')
      GROUP BY sr.id, aa.legal_name, sr.approval_mode, su.full_name, su.phone
      -- صفِ کار یعنی FIFO: درخواستِ قدیمی‌تر باید زودتر به حواله تبدیل شود،
      -- وگرنه نمایندهٔ اول ممکن است پشتِ نماینده‌های تازه‌تر گم بماند.
      ORDER BY sr.created_at ASC
      LIMIT 50`,
  );
}

export type ApproveResult =
  | { ok: true; salesRequestId: string; deduped?: false }
  | { ok: false; reason: "not_found" | "not_active" };

/** چطور تأیید شد — روی sales_request ثبت می‌شود تا «چه کسی تأیید کرد؟» جواب داشته باشد. */
export type ApprovalMode = "manual" | "auto";

/**
 * تأیید رزرو → SalesRequest تأییدشده. جابه‌جاییِ اتمیکِ held → allocated (spec ۱۴.۲).
 * چرا اتمیک مهمه: اگه رزرو زودتر از held خارج شه ولی allocated دیر بالا بره، یه گپ
 * زمانی می‌سازه که موجودی دوباره available دیده می‌شه (باگی که بازبین‌ها flag کردن).
 *
 * ترتیب: قفل balanceها (ORDER BY lot_id) → guardِ تبدیل رزرو → allocation → COMMIT.
 * تأیید «تجاری» است و کارِ staff (route با authorizeStaff گیت می‌کنه)؛ staff هر رزروِ
 * این tenant را تأیید می‌کند، پس agent از خودِ رزرو خوانده می‌شود نه از caller.
 */
export async function approveReservation(params: {
  tenantId: string;
  reservationId: string;
  actorUserId: string;
}): Promise<ApproveResult> {
  return withTenant(params.tenantId, (tx) => approveReservationIn(tx, { ...params, mode: "manual" }));
}

/**
 * همان تأیید، ولی داخلِ تراکنشِ صداکننده — تا `reserve()` بتواند در همان تراکنش
 * تأییدِ خودکار را انجام دهد. اگر دو تراکنش می‌بود، پنجره‌ای می‌ماند که رزرو ساخته
 * شده ولی هنوز تأیید نشده، و شکستِ نیمه‌راه یک رزروِ سرگردان به‌جا می‌گذاشت.
 * (همان الگوی `resolvePrices` / `resolvePricesIn`.)
 */
export async function approveReservationIn(
  tx: postgres.TransactionSql,
  params: {
    tenantId: string;
    reservationId: string;
    /** در تأییدِ خودکار actor انسانی وجود ندارد → null. */
    actorUserId: string | null;
    mode: ApprovalMode;
    /** فقط برای mode='auto': سقفی که اعمال شد (snapshot). */
    limitApplied?: number;
  },
): Promise<ApproveResult> {
  const { tenantId, reservationId, actorUserId, mode, limitApplied } = params;

  {
    // ۱. رزرو باید مالِ همین tenant باشه (وگرنه not_found). agent از خودِ رزرو.
    const [resv] = await tx<{ agent_account_id: string }[]>`
      SELECT agent_account_id FROM reservation
      WHERE id = ${reservationId} AND tenant_id = ${tenantId}`;
    if (!resv) return { ok: false, reason: "not_found" };

    // اقلام رزرو + variant هر lot (برای ساخت SalesRequestItem). مرتب بر lot_id برای قفل.
    const items = await tx<{ lot_id: string; quantity_boxes: number; variant_id: string }[]>`
      SELECT ri.lot_id, ri.quantity_boxes, l.variant_id
      FROM reservation_item ri JOIN inventory_lot l ON l.id = ri.lot_id
      WHERE ri.reservation_id = ${reservationId} AND ri.tenant_id = ${tenantId}
      ORDER BY ri.lot_id`;
    if (items.length === 0) return { ok: false, reason: "not_found" };

    // ۲. قفل balanceها ORDER BY lot_id FOR UPDATE (همون mutexِ رزرو — سریالایز با رزرو/تبدیلِ هم‌زمان)
    const lotIds = items.map((i) => i.lot_id);
    // فیلترِ صریحِ tenant_id در کنار RLS (قانون معماری #۶: با هم، نه یکی به‌جای اون یکی)
    await tx`SELECT lot_id FROM inventory_balance WHERE tenant_id = ${tenantId} AND lot_id IN ${tx(lotIds)} ORDER BY lot_id FOR UPDATE`;

    // ۳. guardِ تبدیل: فقط active و منقضی‌نشده. اگه چیزی برنگشت یعنی قبلاً تبدیل/منقضی شده.
    //    این UPDATE هم قفل منطقی رزروه: دو تأییدِ هم‌زمانِ یک رزرو، فقط یکی ردیف می‌گیره.
    const converted = await tx`
      UPDATE reservation SET status = 'converted'
      WHERE id = ${reservationId} AND tenant_id = ${tenantId}
        AND status = 'active' AND expires_at > now()
      RETURNING id`;
    if (converted.length === 0) return { ok: false, reason: "not_active" };

    // ۴. SalesRequest تأییدشده — با ثبتِ اینکه دستی بود یا خودکار (و با چه سقفی)
    const [sr] = await tx<{ id: string }[]>`
      INSERT INTO sales_request (tenant_id, agent_account_id, reservation_id, status, approval_mode, auto_approve_limit_applied)
      VALUES (${tenantId}, ${resv.agent_account_id}, ${reservationId}, 'approved', ${mode}, ${limitApplied ?? null})
      RETURNING id`;

    // ۵. یک SalesRequestItem به‌ازای هر variant (جمعِ کارتن)، با line_no
    const byVariant = new Map<string, number>();
    for (const it of items) byVariant.set(it.variant_id, (byVariant.get(it.variant_id) ?? 0) + it.quantity_boxes);

    // snapshot قیمت (v2): قیمتِ **لحظه‌ی تأیید** ثبت می‌شود، نه قیمتِ روز.
    // اگر بعداً لیست قیمت عوض شود، سفارشِ ثبت‌شده نباید تغییر کند — وگرنه فاکتور و
    // تاریخچه بازنویسی می‌شود. qty کل هر variant پاس می‌شود تا پله‌ی تخفیف حجمی درست بخورد.
    // نبودِ قیمت → NULL می‌ماند (نه صفر): «قیمت ثبت نشده» با «رایگان» یکی نیست.
    const prices = await resolvePricesIn(tx, {
      tenantId, agentAccountId: resv.agent_account_id,
      variantIds: [...byVariant.keys()],
      qtyByVariant: Object.fromEntries(byVariant),
    });

    const itemIdOf = new Map<string, string>();
    let lineNo = 1;
    for (const [variantId, qty] of byVariant) {
      const p = prices.get(variantId);
      const [sri] = await tx<{ id: string }[]>`
        INSERT INTO sales_request_item
          (tenant_id, request_id, line_no, variant_id, requested_qty_boxes,
           unit_price_applied, currency, price_basis, price_list_id, discount_amount, applied_price_source)
        VALUES (${tenantId}, ${sr.id}, ${lineNo}, ${variantId}, ${qty},
                ${p?.unitPrice ?? null}, ${p ? CURRENCY : null}, ${p ? "per_box" : null},
                ${p?.priceListId ?? null}, ${p?.discountAmount ?? 0}, ${p?.source ?? null})
        RETURNING id`;
      itemIdOf.set(variantId, sri.id);
      lineNo++;
    }

    // ۶. per lot: allocation + balance.allocated += qty + لجر (allocated_delta مثبت)
    //    CHECK(allocated+blocked <= on_hand) تضمین می‌کنه over-allocate نشه — چون این qty
    //    قبلاً در held بود و held ⊆ (on_hand - allocated - blocked)، پس جا هست.
    for (const it of items) {
      await tx`
        INSERT INTO sales_request_allocation (tenant_id, sales_request_item_id, lot_id, allocated_qty_boxes)
        VALUES (${tenantId}, ${itemIdOf.get(it.variant_id)!}, ${it.lot_id}, ${it.quantity_boxes})`;
      await tx`
        UPDATE inventory_balance SET allocated_qty_boxes = allocated_qty_boxes + ${it.quantity_boxes}
        WHERE lot_id = ${it.lot_id} AND tenant_id = ${tenantId}`;
      await tx`
        INSERT INTO inventory_transaction
          (tenant_id, lot_id, transaction_type, allocated_delta_boxes, reference_type, reference_id, actor_user_id, note)
        VALUES (${tenantId}, ${it.lot_id}, 'reservation_convert', ${it.quantity_boxes},
                'sales_request', ${sr.id}, ${actorUserId},
                ${(mode === "auto" ? "تأیید خودکار · " : "") + "held→allocated " + it.quantity_boxes})`;
    }

    // ۷. held این lotها صفر شد (رزرو converted)، allocated همون‌قدر بالا رفت — بدون گپ.
    return { ok: true, salesRequestId: sr.id };
  }
}
