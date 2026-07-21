import { withTenant } from "./client";
import { enqueueRestockNotifications } from "./alerts";
import { advanceWaitlist } from "./waitlist";

export type SnapshotRow = {
  sku: string; warehouseCode: string;
  batchNumber?: string | null; shadeCode?: string | null; caliberCode?: string | null;
  onHand: number;
};
export type ImportScope =
  | { type: "tenant" }
  | { type: "warehouse"; warehouseId: string }
  | { type: "brand"; brandId: string };

export type ImportError = { row: number | null; reason: string; detail?: string };
export type ImportResult = {
  ok: true; batchId: string; deduped: boolean; applied: number; zeroed: number;
  errors: ImportError[]; notified?: number;
};

/**
 * اعمالِ اتمیکِ یک Snapshot اکسل (spec ۱۴.۵). کلِ عملیات در یک تراکنش است — یا کامل
 * commit می‌شه یا هیچ (cutover اتمیک). قواعدِ خطرناک که این‌جا رعایت می‌شن:
 *   • فقط on_hand را دست می‌زنه، نه allocated/blocked/held.
 *   • ردیفِ غایب در فایل → on_hand=0 **فقط داخل scope اعلام‌شده** (نه کل tenant).
 *   • new_on_hand هرگز زیر allocated+blocked نمی‌ره — وگرنه ردیف error می‌شه و رد،
 *     نه اینکه موجودی زیر تعهدِ رزروِ زنده بره (که CHECK دیتابیس هم می‌شکنه).
 *   • idempotent: ImportBatch با UNIQUE(tenant, idempotency_key). کلید تکراری → dedupe.
 */
export async function applySnapshot(params: {
  tenantId: string; uploaderUserId: string; idempotencyKey: string;
  scope: ImportScope; rows: SnapshotRow[]; filename?: string;
}): Promise<ImportResult> {
  const { tenantId, uploaderUserId, idempotencyKey, scope, rows, filename } = params;

  return withTenant(tenantId, async (tx) => {
    // idempotency: چون batch داخل همین تراکنش ساخته می‌شه، «وجود داشتن» یعنی «قبلاً commit شده»
    const [existing] = await tx<{ id: string }[]>`
      SELECT id FROM import_batch WHERE tenant_id = ${tenantId} AND idempotency_key = ${idempotencyKey}`;
    if (existing) return { ok: true, batchId: existing.id, deduped: true, applied: 0, zeroed: 0, errors: [] };

    const [batch] = await tx<{ id: string }[]>`
      INSERT INTO import_batch
        (tenant_id, uploader_user_id, filename, import_mode, idempotency_key,
         scope_type, scope_warehouse_id, scope_brand_id, status, effective_at)
      VALUES (${tenantId}, ${uploaderUserId}, ${filename ?? "snapshot.xlsx"}, 'snapshot', ${idempotencyKey},
              ${scope.type}, ${scope.type === "warehouse" ? scope.warehouseId : null},
              ${scope.type === "brand" ? scope.brandId : null}, 'processing', now())
      RETURNING id`;

    const errors: ImportError[] = [];
    const touched = new Set<string>();
    let applied = 0, zeroed = 0;

    // قفلِ همه‌ی balanceهای داخل scope، **یک‌جا و مرتب بر lot_id**، قبل از هر تغییری.
    // چرا: قانون معماری #۴ می‌گه قفل‌ها همیشه ORDER BY lot_id گرفته شن. نسخه‌ی قبلی هر
    // ردیف را جدا و به ترتیبِ فایل قفل می‌کرد؛ یک import و یک رزروِ هم‌زمان روی دو lot
    // مشترک با ترتیب معکوس → deadlock. با قفلِ مرتبِ اولیه، هم آن ریسک می‌رود و هم یک
    // کوئری به‌ازای هر ردیف کم می‌شود (lotهای تازه‌ساخته انحصاریِ همین تراکنش‌اند).
    const scopeLots = await tx<{ id: string; on_hand: number; committed: number }[]>`
      SELECT l.id, b.on_hand_qty_boxes AS on_hand, b.allocated_qty_boxes + b.blocked_qty_boxes AS committed
      FROM inventory_lot l JOIN inventory_balance b ON b.lot_id = l.id
      JOIN product_variant pv ON pv.id = l.variant_id
      JOIN product p ON p.id = pv.product_id
      WHERE l.tenant_id = ${tenantId}
        AND ${scope.type === "warehouse" ? tx`l.warehouse_id = ${scope.warehouseId}`
            : scope.type === "brand" ? tx`p.brand_id = ${scope.brandId}`
            : tx`TRUE`}
      ORDER BY l.id
      FOR UPDATE OF b`;
    const balOf = new Map(scopeLots.map((l) => [l.id, { on_hand: l.on_hand, committed: l.committed }]));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const err = (reason: string, detail?: string) => {
        errors.push({ row: i + 1, reason, detail });
      };
      if (!Number.isInteger(row.onHand) || row.onHand < 0) { err("bad_on_hand", String(row.onHand)); continue; }

      const [variant] = await tx<{ id: string; brand_id: string | null }[]>`
        SELECT pv.id, p.brand_id FROM product_variant pv JOIN product p ON p.id = pv.product_id
        WHERE pv.tenant_id = ${tenantId} AND pv.sku = ${row.sku}`;
      const [wh] = await tx<{ id: string }[]>`
        SELECT id FROM warehouse WHERE tenant_id = ${tenantId} AND code = ${row.warehouseCode}`;
      if (!variant || !wh) { err("unknown_sku_or_warehouse", `${row.sku}/${row.warehouseCode}`); continue; }

      // در scope هست؟
      if (scope.type === "warehouse" && wh.id !== scope.warehouseId) { err("out_of_scope", row.warehouseCode); continue; }
      if (scope.type === "brand" && variant.brand_id !== scope.brandId) { err("out_of_scope", row.sku); continue; }

      // تطبیقِ Lot با کلیدِ طبیعی (NULL-safe). نبود → ساختِ Lot جدید + balance صفر.
      let [lot] = await tx<{ id: string }[]>`
        SELECT id FROM inventory_lot
        WHERE tenant_id = ${tenantId} AND variant_id = ${variant.id} AND warehouse_id = ${wh.id}
          AND batch_number IS NOT DISTINCT FROM ${row.batchNumber ?? null}
          AND shade_code   IS NOT DISTINCT FROM ${row.shadeCode ?? null}
          AND caliber_code IS NOT DISTINCT FROM ${row.caliberCode ?? null}`;
      if (!lot) {
        [lot] = await tx<{ id: string }[]>`
          INSERT INTO inventory_lot (tenant_id, variant_id, warehouse_id, batch_number, shade_code, caliber_code)
          VALUES (${tenantId}, ${variant.id}, ${wh.id}, ${row.batchNumber ?? null}, ${row.shadeCode ?? null}, ${row.caliberCode ?? null})
          RETURNING id`;
        await tx`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES (${tenantId}, ${lot.id}, 0)`;
      }

      // قفل از قبل گرفته شده؛ lotِ تازه‌ساخته در نقشه نیست و balanceش صفر است
      const bal = balOf.get(lot.id) ?? { on_hand: 0, committed: 0 };
      if (row.onHand < bal.committed) { err("below_committed", `on_hand ${row.onHand} < allocated+blocked ${bal.committed}`); continue; }

      const delta = row.onHand - bal.on_hand;
      if (delta !== 0) {
        await tx`UPDATE inventory_balance SET on_hand_qty_boxes = ${row.onHand} WHERE lot_id = ${lot.id} AND tenant_id = ${tenantId}`;
        await tx`
          INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, reference_type, reference_id, actor_user_id)
          VALUES (${tenantId}, ${lot.id}, 'import_snapshot', ${delta}, 'import_batch', ${batch.id}, ${uploaderUserId})`;
      }
      // tx.json و نه JSON.stringify+cast: دومی مقدار را دوبار encode می‌کرد و
      // raw_data به‌جای object، یک jsonb از نوعِ string می‌شد — یعنی استخراجِ
      // فیلد از آن همیشه NULL می‌داد، در حالی که این ستون دقیقاً برای همان
      // سؤال («در فایل چه بود؟») وجود دارد.
      await tx`
        INSERT INTO import_row (tenant_id, batch_id, row_number, raw_data, processing_status, matched_variant_id, matched_lot_id)
        VALUES (${tenantId}, ${batch.id}, ${i + 1}, ${tx.json(row)}, 'applied', ${variant.id}, ${lot.id})`;
      // نقشه را به‌روز کن: اگر همین lot دوباره در فایل بیاید، delta باید از مقدارِ اعمال‌شده
      // حساب شود نه از مقدارِ اولیه — وگرنه جمعِ لجر با on_hand نهایی نمی‌خواند (drift).
      balOf.set(lot.id, { on_hand: row.onHand, committed: bal.committed });
      touched.add(lot.id);
      applied++;
    }

    // ردیف‌های غایب در scope → صفر (با همون guardِ committed).
    // scopeLots از بالا می‌آید (همان‌جا قفل شد)؛ lotهای دست‌نخورده مقدارشان عوض نشده،
    // پس on_hand/committedِ خوانده‌شده هنوز معتبر است.
    for (const l of scopeLots) {
      if (touched.has(l.id) || l.on_hand === 0) continue;
      if (l.committed > 0) { errors.push({ row: null, reason: "absent_but_committed", detail: l.id }); continue; }
      await tx`UPDATE inventory_balance SET on_hand_qty_boxes = 0 WHERE lot_id = ${l.id} AND tenant_id = ${tenantId}`;
      await tx`
        INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, reference_type, reference_id, actor_user_id)
        VALUES (${tenantId}, ${l.id}, 'import_snapshot_zero', ${-l.on_hand}, 'import_batch', ${batch.id}, ${uploaderUserId})`;
      zeroed++;
    }

    // صف انتظار **قبل از** پخشِ «موجود شد»: صف حقِ تقدم دارد. اگر اول به همه خبر
    // می‌دادیم، نماینده‌ای که در صف منتظر بوده با رهگذرها هم‌رقابت می‌شد و صف
    // بی‌معنا می‌گشت. هرچه به صف برسد از available کم می‌شود، و alert فقط باقیمانده
    // را اعلام می‌کند (و اگر چیزی نماند، اصلاً اعلام نمی‌کند).
    const variants = touched.size === 0 ? [] : await tx<{ variant_id: string }[]>`
      SELECT DISTINCT variant_id FROM inventory_lot
      WHERE tenant_id = ${tenantId} AND id IN ${tx([...touched])}`;
    const offers = await advanceWaitlist(tx, tenantId, variants.map((v) => v.variant_id));

    // Outbox: پیامِ «موجود شد» در همین تراکنش صف می‌شه — اگه import رول‌بک شه، پیامی هم نمی‌مونه
    const notified = await enqueueRestockNotifications(tx, tenantId, [...touched]);

    await tx`UPDATE import_batch SET status = 'committed', committed_at = now() WHERE id = ${batch.id}`;
    return { ok: true, batchId: batch.id, deduped: false, applied, zeroed, errors, notified, offers: offers.length };
  });
}
