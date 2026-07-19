import { withTenant } from "./client";

export type ApproveResult =
  | { ok: true; salesRequestId: string; deduped?: false }
  | { ok: false; reason: "not_found" | "not_active" };

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
  const { tenantId, reservationId, actorUserId } = params;

  return withTenant(tenantId, async (tx) => {
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
    await tx`SELECT lot_id FROM inventory_balance WHERE lot_id IN ${tx(lotIds)} ORDER BY lot_id FOR UPDATE`;

    // ۳. guardِ تبدیل: فقط active و منقضی‌نشده. اگه چیزی برنگشت یعنی قبلاً تبدیل/منقضی شده.
    //    این UPDATE هم قفل منطقی رزروه: دو تأییدِ هم‌زمانِ یک رزرو، فقط یکی ردیف می‌گیره.
    const converted = await tx`
      UPDATE reservation SET status = 'converted'
      WHERE id = ${reservationId} AND tenant_id = ${tenantId}
        AND status = 'active' AND expires_at > now()
      RETURNING id`;
    if (converted.length === 0) return { ok: false, reason: "not_active" };

    // ۴. SalesRequest تأییدشده
    const [sr] = await tx<{ id: string }[]>`
      INSERT INTO sales_request (tenant_id, agent_account_id, status)
      VALUES (${tenantId}, ${resv.agent_account_id}, 'approved')
      RETURNING id`;

    // ۵. یک SalesRequestItem به‌ازای هر variant (جمعِ کارتن)، با line_no
    const byVariant = new Map<string, number>();
    for (const it of items) byVariant.set(it.variant_id, (byVariant.get(it.variant_id) ?? 0) + it.quantity_boxes);
    const itemIdOf = new Map<string, string>();
    let lineNo = 1;
    for (const [variantId, qty] of byVariant) {
      const [sri] = await tx<{ id: string }[]>`
        INSERT INTO sales_request_item (tenant_id, request_id, line_no, variant_id, requested_qty_boxes)
        VALUES (${tenantId}, ${sr.id}, ${lineNo}, ${variantId}, ${qty})
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
                'sales_request', ${sr.id}, ${actorUserId}, ${"held→allocated " + it.quantity_boxes})`;
    }

    // ۷. COMMIT خودکار. held این lotها صفر شد (رزرو converted)، allocated همون‌قدر بالا رفت — بدون گپ.
    return { ok: true, salesRequestId: sr.id };
  });
}
