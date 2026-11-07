import type { JSONValue, TransactionSql } from "postgres";
import { withTenant } from "./client";
import { addProductImageTx } from "./products";
import { enqueueRestockNotifications } from "./alerts";
import { normalizeRow, type ImportRow, type RowError } from "@/lib/importRows";

export type ImportScope =
  | { type: "tenant" }
  | { type: "warehouse"; warehouseId: string }
  | { type: "brand"; brandId: string };

export type ImportError = RowError;
/** یک lot که عوض می‌شود. lotId تهی یعنی lot تازه؛ row تهی یعنی غایب در فایل و صفرشونده. */
export type ImportChange = {
  row: number | null; sku: string; warehouseCode: string;
  batchNumber: string | null; shadeCode: string | null; caliberCode: string | null;
  lotId: string | null; before: number; after: number; committed: number;
};
export type ImportResult = {
  /** false یعنی هیچ چیزی نوشته نشد. */
  ok: boolean; preview: boolean; deduped: boolean; batchId: string | null;
  applied: number; zeroed: number; newLots: number; newProducts: number;
  errors: ImportError[]; changes: ImportChange[]; notified?: number;
};

type ScopeLot = {
  id: string; variant_id: string; warehouse_id: string; sku: string; warehouse_code: string;
  batch_number: string | null; shade_code: string | null; caliber_code: string | null;
  on_hand: number; committed: number;
};

/** import و undo در هر tenant پشت هم اجرا می‌شوند؛ دو import هم‌زمان lot تکراری نمی‌سازند. */
const importLock = (tx: TransactionSql, tenantId: string) =>
  tx`SELECT pg_advisory_xact_lock(hashtext(${"import:" + tenantId}))`;

/**
 * held زنده‌ی هر lot، بعد از قفلِ ردیف‌های balance (همان SUMِ reservations.ts).
 * تعهدِ کامل = allocated + blocked + held؛ on_hand هرگز زیرش نمی‌رود (فاز ۵، E3-F3).
 */
async function heldOf(tx: TransactionSql, tenantId: string, lotIds: string[]) {
  if (lotIds.length === 0) return new Map<string, number>();
  const rows = await tx<{ lot_id: string; held: number }[]>`
    SELECT ri.lot_id, SUM(ri.quantity_boxes)::int AS held
    FROM reservation_item ri JOIN reservation r ON r.id = ri.reservation_id
    WHERE ri.tenant_id = ${tenantId} AND ri.lot_id IN ${tx(lotIds)}
      AND r.status = 'active' AND r.expires_at > now()
    GROUP BY ri.lot_id`;
  return new Map(rows.map((r) => [r.lot_id, r.held]));
}

const same = (a: string | null, b: string | null) => a === b;

/**
 * Snapshot اکسل (spec ۱۴.۵)، برای ورودِ اولیه‌ی محصولات و موجودیِ کارخانه.
 *
 * دو مرحله: اول همه‌ی ردیف‌ها بدونِ هیچ نوشتنی سنجیده می‌شوند. اگر حتی یک خطا باشد،
 * یا preview خواسته شده باشد، هیچ چیزی نوشته نمی‌شود و نتیجه همان برنامه است.
 * فقط فایلِ کاملاً سالم اعمال می‌شود.
 *
 * قواعد:
 *   • lotِ غایب در فایل، فقط داخلِ scope صفر می‌شود. فایلِ خالی رد می‌شود.
 *   • on_hand هرگز زیرِ allocated + blocked + heldِ زنده نمی‌رود؛ چنین ردیفی خطاست.
 *   • کلیدِ طبیعیِ lot: کالا + انبار + بچ + شید + کالیبر (NULL-safe). `track_shade_caliber`ِ
 *     کارخانه تعیینش می‌کند: off یعنی شید و کالیبر نادیده، required یعنی اجباری.
 *     اگر دو lot با یک کلید پیدا شود، ردیف خطاست، نه انتخابِ دلبخواه.
 *   • دو ردیف برای یک lot خطاست: معلوم نیست کدام درست است.
 *   • idempotent با UNIQUE(tenant, idempotency_key).
 */
export async function applySnapshot(params: {
  tenantId: string; uploaderUserId: string; idempotencyKey: string;
  scope: ImportScope; rows: Record<string, unknown>[]; filename?: string; preview?: boolean;
}): Promise<ImportResult> {
  const { tenantId, uploaderUserId, idempotencyKey, scope, filename } = params;
  const preview = params.preview === true;
  const result: ImportResult = {
    ok: false, preview, deduped: false, batchId: null,
    applied: 0, zeroed: 0, newLots: 0, newProducts: 0, errors: [], changes: [],
  };
  const errors = result.errors;

  return withTenant(tenantId, async (tx) => {
    await importLock(tx, tenantId);
    const [existing] = await tx<{ id: string }[]>`
      SELECT id FROM import_batch WHERE tenant_id = ${tenantId} AND idempotency_key = ${idempotencyKey}`;
    if (existing) return { ...result, ok: true, deduped: true, batchId: existing.id };

    // scopeِ tenantِ دیگر یا ناموجود: قبلاً FK می‌خورد و ۵۰۰ می‌داد
    const scopeFound = scope.type === "tenant" ? true
      : scope.type === "warehouse"
        ? (await tx`SELECT 1 FROM warehouse WHERE tenant_id = ${tenantId} AND id = ${scope.warehouseId}`).length > 0
        : (await tx`SELECT 1 FROM brand WHERE tenant_id = ${tenantId} AND id = ${scope.brandId}`).length > 0;
    if (!scopeFound) { errors.push({ row: null, reason: "scope_not_found" }); return result; }
    if (params.rows.length === 0) { errors.push({ row: null, reason: "empty_file" }); return result; }

    const [{ mode }] = await tx<{ mode: "off" | "optional" | "required" }[]>`
      SELECT track_shade_caliber AS mode FROM tenant WHERE id = ${tenantId}`;

    // قفلِ همه‌ی balanceهای scope، یک‌جا و مرتب بر lot_id (قانون ۴)، قبل از هر سنجشی
    const scopeLots = await tx<ScopeLot[]>`
      SELECT l.id, l.variant_id, l.warehouse_id, pv.sku, w.code AS warehouse_code,
             l.batch_number, l.shade_code, l.caliber_code,
             b.on_hand_qty_boxes AS on_hand, b.allocated_qty_boxes + b.blocked_qty_boxes AS committed
      FROM inventory_lot l JOIN inventory_balance b ON b.lot_id = l.id
      JOIN product_variant pv ON pv.id = l.variant_id
      JOIN product p ON p.id = pv.product_id
      JOIN warehouse w ON w.id = l.warehouse_id
      WHERE l.tenant_id = ${tenantId}
        AND ${scope.type === "warehouse" ? tx`l.warehouse_id = ${scope.warehouseId}`
            : scope.type === "brand" ? tx`p.brand_id = ${scope.brandId}`
            : tx`TRUE`}
      ORDER BY l.id
      FOR UPDATE OF b`;
    const held = await heldOf(tx, tenantId, scopeLots.map((l) => l.id));
    for (const l of scopeLots) l.committed += held.get(l.id) ?? 0;

    const variants = new Map((await tx<{ id: string; sku: string; product_id: string; brand_id: string | null }[]>`
      SELECT pv.id, pv.sku, pv.product_id, p.brand_id FROM product_variant pv JOIN product p ON p.id = pv.product_id
      WHERE pv.tenant_id = ${tenantId}`).map((v) => [v.sku, v]));
    const warehouses = new Map((await tx<{ id: string; code: string }[]>`
      SELECT id, code FROM warehouse WHERE tenant_id = ${tenantId}`).map((w) => [w.code, w.id]));

    // ── مرحله‌ی ۱: سنجشِ همه، بدونِ نوشتن ──
    type Plan = { raw: Record<string, unknown>; r: ImportRow; variantId: string | null; productId: string | null; whId: string; lot: ScopeLot | null; key: string };
    const plans: Plan[] = [];
    const seen = new Map<string, number>(); // کلیدِ lot → شماره‌ی ردیف
    const newSkus = new Set<string>();

    params.rows.forEach((raw, i) => {
      const { row: r, errors: rowErrs } = normalizeRow(raw, i);
      errors.push(...rowErrs);
      if (rowErrs.length) return;
      const err = (reason: string, detail?: string) => errors.push({ row: r.row, reason, detail });
      const sku = r.sku!, whCode = r.warehouseCode!;

      if (mode === "off") { r.shadeCode = null; r.caliberCode = null; }
      if (mode === "required" && (!r.shadeCode || !r.caliberCode)) return err("missing_shade_caliber", sku);

      const variant = variants.get(sku);
      // محصولِ تازه فقط با نام؛ skuِ ناموجودِ بی‌نام بیشتر غلطِ تایپی است
      if (!variant && !r.name) return err("unknown_sku", sku);
      const whId = warehouses.get(whCode);
      if (!whId) return err("unknown_warehouse", whCode);
      if (scope.type === "warehouse" && whId !== scope.warehouseId) return err("out_of_scope", whCode);
      if (scope.type === "brand" && variant?.brand_id !== scope.brandId) return err("out_of_scope", sku);

      const matches = variant ? scopeLots.filter((l) =>
        l.variant_id === variant.id && l.warehouse_id === whId && same(l.batch_number, r.batchNumber)
        && (mode === "off" || (same(l.shade_code, r.shadeCode) && same(l.caliber_code, r.caliberCode)))) : [];
      if (matches.length > 1) return err("ambiguous_lot", `${matches.length} lot با همین کالا، انبار، بچ، شید و کالیبر`);
      const lot = matches[0] ?? null;

      const key = lot ? lot.id : JSON.stringify([sku, whId, r.batchNumber, r.shadeCode, r.caliberCode]);
      const prev = seen.get(key);
      if (prev !== undefined) return err("duplicate_row", `همان lotِ ردیف ${prev}`);
      seen.set(key, r.row);

      if (lot && r.onHand! < lot.committed)
        return err("below_committed", `${r.onHand} < ${lot.committed} (رزرو، تخصیص و بلوکه‌ی فعلی)`);

      if (!variant) newSkus.add(sku);
      plans.push({ raw, r, variantId: variant?.id ?? null, productId: variant?.product_id ?? null, whId, lot, key });
      if (!lot || lot.on_hand !== r.onHand) result.changes.push({
        row: r.row, sku, warehouseCode: whCode, batchNumber: r.batchNumber, shadeCode: r.shadeCode,
        caliberCode: r.caliberCode, lotId: lot?.id ?? null, before: lot?.on_hand ?? 0, after: r.onHand!,
        committed: lot?.committed ?? 0,
      });
    });

    const absent = scopeLots.filter((l) => !seen.has(l.id) && l.on_hand > 0);
    for (const l of absent) {
      if (l.committed > 0) {
        errors.push({ row: null, reason: "absent_but_committed",
          detail: `${l.sku} / ${l.warehouse_code} / ${l.batch_number ?? "-"}: ${l.committed} کارتن تعهد دارد` });
        continue;
      }
      result.changes.push({
        row: null, sku: l.sku, warehouseCode: l.warehouse_code, batchNumber: l.batch_number,
        shadeCode: l.shade_code, caliberCode: l.caliber_code, lotId: l.id, before: l.on_hand, after: 0, committed: 0,
      });
    }

    result.applied = plans.length;
    result.zeroed = absent.length;
    result.newLots = plans.filter((p) => !p.lot).length;
    result.newProducts = newSkus.size;
    if (errors.length > 0) return result;
    result.ok = true;
    if (preview) return result;

    // ── مرحله‌ی ۲: اعمال. همه چیز سنجیده شده؛ این‌جا فقط نوشتن است ──
    const [batch] = await tx<{ id: string }[]>`
      INSERT INTO import_batch
        (tenant_id, uploader_user_id, filename, import_mode, idempotency_key,
         scope_type, scope_warehouse_id, scope_brand_id, status, effective_at)
      VALUES (${tenantId}, ${uploaderUserId}, ${filename ?? "snapshot.xlsx"}, 'snapshot', ${idempotencyKey},
              ${scope.type}, ${scope.type === "warehouse" ? scope.warehouseId : null},
              ${scope.type === "brand" ? scope.brandId : null}, 'processing', now())
      RETURNING id`;
    const ledger = (lotId: string, type: string, delta: number) => tx`
      INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, reference_type, reference_id, actor_user_id)
      VALUES (${tenantId}, ${lotId}, ${type}, ${delta}, 'import_batch', ${batch.id}, ${uploaderUserId})`;

    const createdVariant = new Map<string, { id: string; product_id: string }>();
    const touched: string[] = [];
    for (const p of plans) {
      const r = p.r, sku = r.sku!;
      let variantId = p.variantId, productId = p.productId;
      if (!variantId) {
        let v = createdVariant.get(sku);
        if (!v) {
          // کدِ محصول = sku (فایل ستونِ کدِ جدا ندارد)
          const [prod] = await tx<{ id: string }[]>`
            INSERT INTO product (tenant_id, code, name, color, glaze, punch, body)
            VALUES (${tenantId}, ${sku}, ${r.name}, ${r.color}, ${r.glaze}, ${r.punch}, ${r.body})
            ON CONFLICT (tenant_id, code) DO UPDATE SET name = product.name
            RETURNING id`;
          [v] = await tx<{ id: string; product_id: string }[]>`
            INSERT INTO product_variant (tenant_id, product_id, sku) VALUES (${tenantId}, ${prod.id}, ${sku})
            RETURNING id, product_id`;
          createdVariant.set(sku, v);
        }
        variantId = v.id; productId = v.product_id;
      }
      // عکس فقط وقتی مقدار دارد؛ ستونِ خالی عکسِ قبلی را پاک نمی‌کند
      if (r.imageUrl) await addProductImageTx(tx, tenantId, productId!, r.imageUrl);

      let lotId = p.lot?.id;
      if (!lotId) {
        [{ id: lotId }] = await tx<{ id: string }[]>`
          INSERT INTO inventory_lot (tenant_id, variant_id, warehouse_id, batch_number, shade_code, caliber_code)
          VALUES (${tenantId}, ${variantId}, ${p.whId}, ${r.batchNumber}, ${r.shadeCode}, ${r.caliberCode})
          RETURNING id`;
        await tx`INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes) VALUES (${tenantId}, ${lotId}, 0)`;
      }
      const delta = r.onHand! - (p.lot?.on_hand ?? 0);
      if (delta !== 0) {
        await tx`UPDATE inventory_balance SET on_hand_qty_boxes = ${r.onHand} WHERE lot_id = ${lotId} AND tenant_id = ${tenantId}`;
        await ledger(lotId, "import_snapshot", delta);
      }
      await tx`
        INSERT INTO import_row (tenant_id, batch_id, row_number, raw_data, normalized_data, processing_status, matched_variant_id, matched_lot_id)
        VALUES (${tenantId}, ${batch.id}, ${r.row}, ${tx.json(p.raw as JSONValue)}, ${tx.json(r)}, 'applied', ${variantId}, ${lotId})`;
      touched.push(lotId);
    }
    for (const l of absent) {
      await tx`UPDATE inventory_balance SET on_hand_qty_boxes = 0 WHERE lot_id = ${l.id} AND tenant_id = ${tenantId}`;
      await ledger(l.id, "import_snapshot_zero", -l.on_hand);
    }

    // پیامِ «موجود شد» در همین تراکنش صف می‌شود
    result.notified = await enqueueRestockNotifications(tx, tenantId, touched);
    await tx`UPDATE import_batch SET status = 'committed', committed_at = clock_timestamp() WHERE id = ${batch.id}`;
    result.batchId = batch.id;
    return result;
  });
}

export type UndoResult =
  | { ok: true; reverted: number }
  | { ok: false; reason: "not_found" | "not_committed" | "not_latest" | "below_committed"; errors?: ImportError[] };

/**
 * برگرداندنِ یک ایمپورتِ اعمال‌شده: deltaی همان ایمپورت از on_handِ فعلی کم می‌شود.
 * پس تغییرهای بعدی (بارگیری، ورود کالا) سرِ جایشان می‌مانند. فقط آخرین ایمپورتِ اعمال‌شده
 * برمی‌گردد، چون snapshotِ بعدی خودش وضعیتِ معتبر است. اگر برگشت on_hand را زیرِ تعهدِ
 * فعلی ببرد، هیچ lotی برنمی‌گردد. محصول و lotِ ساخته‌شده و عکس‌ها می‌مانند (موجودی‌شان برمی‌گردد).
 */
export async function undoImport(params: { tenantId: string; userId: string; batchId: string }): Promise<UndoResult> {
  const { tenantId, userId, batchId } = params;
  return withTenant(tenantId, async (tx) => {
    await importLock(tx, tenantId);
    const [b] = await tx<{ status: string }[]>`
      SELECT status FROM import_batch WHERE tenant_id = ${tenantId} AND id = ${batchId} FOR UPDATE`;
    if (!b) return { ok: false, reason: "not_found" };
    if (b.status !== "committed") return { ok: false, reason: "not_committed" };
    // مقایسه در SQL: Date در JS میکروثانیه را می‌اندازد و هر batch از خودش قدیمی‌تر می‌شد
    const later = await tx`
      SELECT 1 FROM import_batch o, import_batch me
      WHERE me.id = ${batchId} AND o.tenant_id = ${tenantId} AND o.id <> me.id
        AND o.status = 'committed' AND o.committed_at > me.committed_at`;
    if (later.length) return { ok: false, reason: "not_latest" };

    const deltas = await tx<{ lot_id: string; d: number }[]>`
      SELECT lot_id, SUM(on_hand_delta_boxes)::int AS d FROM inventory_transaction
      WHERE tenant_id = ${tenantId} AND reference_type = 'import_batch' AND reference_id = ${batchId}
        AND transaction_type IN ('import_snapshot', 'import_snapshot_zero')
      GROUP BY lot_id HAVING SUM(on_hand_delta_boxes) <> 0`;
    const lotIds = deltas.map((d) => d.lot_id);
    const bal = lotIds.length === 0 ? [] : await tx<{ lot_id: string; on_hand: number; committed: number }[]>`
      SELECT lot_id, on_hand_qty_boxes AS on_hand, allocated_qty_boxes + blocked_qty_boxes AS committed
      FROM inventory_balance WHERE tenant_id = ${tenantId} AND lot_id IN ${tx(lotIds)}
      ORDER BY lot_id FOR UPDATE`;
    const held = await heldOf(tx, tenantId, lotIds);
    const dOf = new Map(deltas.map((d) => [d.lot_id, d.d]));

    const errors: ImportError[] = [];
    for (const x of bal) {
      const after = x.on_hand - dOf.get(x.lot_id)!;
      const committed = x.committed + (held.get(x.lot_id) ?? 0);
      if (after < committed) errors.push({ row: null, reason: "below_committed", detail: `${x.lot_id}: ${after} < ${committed}` });
    }
    if (errors.length) return { ok: false, reason: "below_committed", errors };

    for (const x of bal) {
      const d = dOf.get(x.lot_id)!;
      await tx`UPDATE inventory_balance SET on_hand_qty_boxes = on_hand_qty_boxes - ${d} WHERE lot_id = ${x.lot_id} AND tenant_id = ${tenantId}`;
      await tx`
        INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, reference_type, reference_id, actor_user_id)
        VALUES (${tenantId}, ${x.lot_id}, 'import_undo', ${-d}, 'import_batch', ${batchId}, ${userId})`;
    }
    await enqueueRestockNotifications(tx, tenantId, deltas.filter((d) => d.d < 0).map((d) => d.lot_id));
    await tx`UPDATE import_batch SET status = 'reverted' WHERE id = ${batchId}`;
    return { ok: true, reverted: bal.length };
  });
}

/** آخرین ایمپورت‌ها برای صفحه‌ی ایمپورت، تا برگرداندن بعد از بستنِ صفحه هم ممکن باشد. */
export async function listImports(tenantId: string, limit = 10) {
  return withTenant(tenantId, (tx) => tx<{
    id: string; filename: string; status: string; scopeType: string; committedAt: Date | null; rows: number;
  }[]>`
    SELECT b.id, b.filename, b.status, b.scope_type AS "scopeType", b.committed_at AS "committedAt",
           (SELECT count(*)::int FROM import_row r WHERE r.batch_id = b.id AND r.tenant_id = b.tenant_id) AS rows
    FROM import_batch b
    WHERE b.tenant_id = ${tenantId} AND b.status IN ('committed', 'reverted')
    ORDER BY b.created_at DESC LIMIT ${limit}`);
}
