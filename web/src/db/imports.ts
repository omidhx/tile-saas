import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { withTenant } from "./client";
import { addProductImageTx } from "./products";
import { enqueueRestockNotifications } from "./alerts";
import { applyPalletDeltas, heldOf } from "./pallets";
import { normalizeRow, columnErrors, type ImportRow, type RowError } from "@/lib/importRows";

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
  errors: ImportError[];
  /** اعمال را نمی‌بندند ولی کارمند باید ببیند، مثلِ lotِ تازه کنارِ lotِ صفرشونده. */
  warnings: ImportError[];
  changes: ImportChange[]; notified?: number;
};

type ScopeLot = {
  id: string; variant_id: string; warehouse_id: string; sku: string; warehouse_code: string;
  batch_number: string | null; shade_code: string | null; caliber_code: string | null;
  on_hand: number; committed: number;
};

/** import و undo در هر tenant پشت هم اجرا می‌شوند؛ دو import هم‌زمان lot تکراری نمی‌سازند. */
const importLock = (tx: TransactionSql, tenantId: string) =>
  tx`SELECT pg_advisory_xact_lock(hashtext(${"import:" + tenantId}))`;

// بچ، شید و کالیبر بدونِ حساسیت به حروفِ کوچک و بزرگ و فاصله‌ی دو سر: «b1» و «B1» یک lot است
const nk = (v: string | null) => (v == null ? null : v.trim().toUpperCase());
const same = (a: string | null, b: string | null) => nk(a) === nk(b);
const lotLabel = (b: string | null, s: string | null, c: string | null) => [b, s, c].filter(Boolean).join(" / ") || "-";

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
 *   • دو ردیف برای یک lot، یا دو ستون برای یک فیلد، خطاست: معلوم نیست کدام درست است.
 *   • idempotent با UNIQUE(tenant, idempotency_key)؛ همان کلید با فایلِ دیگر خطاست.
 */
export async function applySnapshot(params: {
  tenantId: string; uploaderUserId: string; idempotencyKey: string;
  scope: ImportScope; rows: Record<string, unknown>[]; filename?: string; preview?: boolean;
}): Promise<ImportResult> {
  const { tenantId, uploaderUserId, idempotencyKey, scope, filename } = params;
  const preview = params.preview === true;
  const result: ImportResult = {
    ok: false, preview, deduped: false, batchId: null,
    applied: 0, zeroed: 0, newLots: 0, newProducts: 0, errors: [], warnings: [], changes: [],
  };
  const errors = result.errors;
  const checksum = createHash("sha256").update(JSON.stringify([scope, params.rows])).digest("hex");

  return withTenant(tenantId, async (tx) => {
    await importLock(tx, tenantId);
    const [existing] = await tx<{ id: string; checksum: string | null }[]>`
      SELECT id, checksum FROM import_batch WHERE tenant_id = ${tenantId} AND idempotency_key = ${idempotencyKey}`;
    if (existing) {
      // مثلِ رزرو: کلیدِ تکراری با فایلِ دیگر نباید «قبلاً اعمال شد» بگوید
      if (existing.checksum && existing.checksum !== checksum) { errors.push({ row: null, reason: "idempotency_mismatch" }); return result; }
      return { ...result, ok: true, deduped: true, batchId: existing.id };
    }

    // scopeِ tenantِ دیگر یا ناموجود: قبلاً FK می‌خورد و ۵۰۰ می‌داد
    const scopeFound = scope.type === "tenant" ? true
      : scope.type === "warehouse"
        ? (await tx`SELECT 1 FROM warehouse WHERE tenant_id = ${tenantId} AND id = ${scope.warehouseId}`).length > 0
        : (await tx`SELECT 1 FROM brand WHERE tenant_id = ${tenantId} AND id = ${scope.brandId}`).length > 0;
    if (!scopeFound) { errors.push({ row: null, reason: "scope_not_found" }); return result; }
    if (params.rows.length === 0) { errors.push({ row: null, reason: "empty_file" }); return result; }
    const colErrs = columnErrors(params.rows);
    if (colErrs.length) { errors.push(...colErrs); return result; }

    const [{ mode }] = await tx<{ mode: "off" | "optional" | "required" }[]>`
      SELECT track_shade_caliber AS mode FROM tenant WHERE id = ${tenantId}`;

    // قفلِ همه‌ی balanceهای scope، یک‌جا و مرتب بر lot_id (قانون ۴)، قبل از هر سنجشی.
    // پیش‌نمایش چیزی نمی‌نویسد، پس ردیفی قفل نمی‌کند تا رزروها منتظرش نمانند؛
    // اعمال همه چیز را دوباره زیرِ قفل می‌سنجد.
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
      ${preview ? tx`` : tx`FOR UPDATE OF b`}`;
    const held = await heldOf(tx, tenantId, scopeLots.map((l) => l.id));
    for (const l of scopeLots) l.committed += held.get(l.id) ?? 0;
    // ردیف‌ها فقط با lotهای همان کالا و انبار مقایسه می‌شوند، نه با کلِ scope (۵۰۰۰ × ۵۰۰۰)
    const vw = (v: string, w: string) => v + "|" + w;
    const lotsOf = new Map<string, ScopeLot[]>();
    for (const l of scopeLots) lotsOf.set(vw(l.variant_id, l.warehouse_id), [...(lotsOf.get(vw(l.variant_id, l.warehouse_id)) ?? []), l]);

    const variants = new Map((await tx<{ id: string; sku: string; product_id: string; brand_id: string | null }[]>`
      SELECT pv.id, pv.sku, pv.product_id, p.brand_id FROM product_variant pv JOIN product p ON p.id = pv.product_id
      WHERE pv.tenant_id = ${tenantId}`).map((v) => [v.sku, v]));
    const warehouses = new Map((await tx<{ id: string; code: string }[]>`
      SELECT id, code FROM warehouse WHERE tenant_id = ${tenantId}`).map((w) => [w.code, w.id]));

    // ── مرحله‌ی ۱: سنجشِ همه، بدونِ نوشتن ──
    type Plan = { raw: Record<string, unknown>; r: ImportRow; variantId: string | null; whId: string; lot: ScopeLot | null };
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

      const matches = variant ? (lotsOf.get(vw(variant.id, whId)) ?? []).filter((l) =>
        same(l.batch_number, r.batchNumber)
        && (mode === "off" || (same(l.shade_code, r.shadeCode) && same(l.caliber_code, r.caliberCode)))) : [];
      if (matches.length > 1) return err("ambiguous_lot", `${matches.length} lot با همین کالا، انبار، بچ، شید و کالیبر`);
      const lot = matches[0] ?? null;

      const key = lot ? lot.id : JSON.stringify([sku, whId, nk(r.batchNumber), nk(r.shadeCode), nk(r.caliberCode)]);
      const prev = seen.get(key);
      if (prev !== undefined) return err("duplicate_row", `همان lotِ ردیف ${prev}`);
      seen.set(key, r.row);

      if (lot && r.onHand! < lot.committed)
        return err("below_committed", `${r.onHand} < ${lot.committed} (رزرو، تخصیص و بلوکه‌ی فعلی)`);

      if (!variant) newSkus.add(sku);
      plans.push({ raw, r, variantId: variant?.id ?? null, whId, lot });
      if (!lot || lot.on_hand !== r.onHand) result.changes.push({
        row: r.row, sku, warehouseCode: whCode, batchNumber: r.batchNumber, shadeCode: r.shadeCode,
        caliberCode: r.caliberCode, lotId: lot?.id ?? null, before: lot?.on_hand ?? 0, after: r.onHand!,
        committed: lot?.committed ?? 0,
      });
    });

    const absent = scopeLots.filter((l) => !seen.has(l.id) && l.on_hand > 0);
    const absentSet = new Set(absent);
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
    // lotِ تازه کنارِ lotِ صفرشونده‌ی همان کالا و انبار معمولاً یعنی کلید فرق کرده
    // («001» و «1»، شیدی که ستونش تازه آمده)، نه بچِ واقعاً تازه. خطا نیست، ولی باید دیده شود.
    for (const p of plans) {
      if (p.lot || !p.variantId) continue;
      const old = (lotsOf.get(vw(p.variantId, p.whId)) ?? []).find((l) => absentSet.has(l));
      if (old) result.warnings.push({
        row: p.r.row, reason: "new_lot_replaces",
        detail: `${p.r.sku}: lotِ تازه «${lotLabel(p.r.batchNumber, p.r.shadeCode, p.r.caliberCode)}»، و lotِ «${lotLabel(old.batch_number, old.shade_code, old.caliber_code)}» صفر می‌شود`,
      });
    }

    result.applied = plans.length;
    result.zeroed = absent.length;
    result.newLots = plans.filter((p) => !p.lot).length;
    result.newProducts = newSkus.size;
    if (errors.length > 0) return result;
    result.ok = true;
    if (preview) return result;

    // ── مرحله‌ی ۲: اعمال، دسته‌ای. ردیف‌به‌ردیف، ۵۰۰۰ ردیف بیش از ۱۵ ثانیه قفل را نگه می‌داشت ──
    const [batch] = await tx<{ id: string }[]>`
      INSERT INTO import_batch
        (tenant_id, uploader_user_id, filename, import_mode, idempotency_key, checksum,
         scope_type, scope_warehouse_id, scope_brand_id, status, effective_at)
      VALUES (${tenantId}, ${uploaderUserId}, ${filename ?? "snapshot.xlsx"}, 'snapshot', ${idempotencyKey}, ${checksum},
              ${scope.type}, ${scope.type === "warehouse" ? scope.warehouseId : null},
              ${scope.type === "brand" ? scope.brandId : null}, 'processing', now())
      RETURNING id`;

    // محصول و variantِ تازه؛ کدِ محصول = sku (فایل ستونِ کدِ جدا ندارد)
    const firstOf = new Map<string, ImportRow>();
    for (const p of plans) if (!p.variantId && !firstOf.has(p.r.sku!)) firstOf.set(p.r.sku!, p.r);
    const variantOf = new Map<string, { id: string; product_id: string }>();
    if (firstOf.size) {
      const np = [...firstOf.values()];
      const col = (f: keyof ImportRow) => np.map((r) => r[f] as string | null);
      const prods = await tx<{ id: string; code: string }[]>`
        INSERT INTO product (tenant_id, code, name, color, glaze, punch, body)
        SELECT ${tenantId}::uuid, * FROM unnest(${col("sku")}::text[], ${col("name")}::text[], ${col("color")}::text[],
               ${col("glaze")}::text[], ${col("punch")}::text[], ${col("body")}::text[])
        ON CONFLICT (tenant_id, code) DO UPDATE SET name = product.name
        RETURNING id, code`;
      const vs = await tx<{ id: string; product_id: string; sku: string }[]>`
        INSERT INTO product_variant (tenant_id, product_id, sku)
        SELECT ${tenantId}::uuid, * FROM unnest(${prods.map((p) => p.id)}::uuid[], ${prods.map((p) => p.code)}::text[])
        RETURNING id, product_id, sku`;
      for (const v of vs) variantOf.set(v.sku, v);
    }
    const vid = (p: Plan) => p.variantId ?? variantOf.get(p.r.sku!)!.id;

    // عکس فقط وقتی مقدار دارد؛ ستونِ خالی عکسِ قبلی را پاک نمی‌کند. هر جفتِ محصول و آدرس یک بار.
    const pidOf = new Map([...variants.values()].map((v) => [v.id, v.product_id]));
    for (const v of variantOf.values()) pidOf.set(v.id, v.product_id);
    const images = new Map<string, [string, string]>();
    for (const p of plans) if (p.r.imageUrl) { const pid = pidOf.get(vid(p))!; images.set(pid + p.r.imageUrl, [pid, p.r.imageUrl]); }
    for (const [pid, url] of images.values()) await addProductImageTx(tx, tenantId, pid, url);

    // lotِ تازه با موجودیِ همان فایل. انحصاریِ همین تراکنش است، پس قفلِ جدا لازم ندارد.
    const lotOf = new Map<Plan, string>();
    for (const p of plans) if (p.lot) lotOf.set(p, p.lot.id);
    const fresh = plans.filter((p) => !p.lot);
    if (fresh.length) {
      const lk = (v: string, w: string, b: string | null, s: string | null, c: string | null) => JSON.stringify([v, w, b, s, c]);
      const made = await tx<{ id: string; variant_id: string; warehouse_id: string; batch_number: string | null; shade_code: string | null; caliber_code: string | null }[]>`
        INSERT INTO inventory_lot (tenant_id, variant_id, warehouse_id, batch_number, shade_code, caliber_code)
        SELECT ${tenantId}::uuid, * FROM unnest(${fresh.map(vid)}::uuid[], ${fresh.map((p) => p.whId)}::uuid[],
               ${fresh.map((p) => p.r.batchNumber)}::text[], ${fresh.map((p) => p.r.shadeCode)}::text[], ${fresh.map((p) => p.r.caliberCode)}::text[])
        RETURNING id, variant_id, warehouse_id, batch_number, shade_code, caliber_code`;
      const byKey = new Map(made.map((l) => [lk(l.variant_id, l.warehouse_id, l.batch_number, l.shade_code, l.caliber_code), l.id]));
      for (const p of fresh) lotOf.set(p, byKey.get(lk(vid(p), p.whId, p.r.batchNumber, p.r.shadeCode, p.r.caliberCode))!);
      await tx`
        INSERT INTO inventory_balance (tenant_id, lot_id, on_hand_qty_boxes)
        SELECT ${tenantId}::uuid, * FROM unnest(${fresh.map((p) => lotOf.get(p)!)}::uuid[], ${fresh.map((p) => p.r.onHand!)}::int[])`;
    }

    // تغییرِ lotهای موجود و صفرِ غایب‌ها در یک UPDATE؛ همه زیرِ قفلِ بالا هستند
    const upd: [string, number][] = [
      ...plans.filter((p) => p.lot && p.lot.on_hand !== p.r.onHand).map((p): [string, number] => [p.lot!.id, p.r.onHand!]),
      ...absent.map((l): [string, number] => [l.id, 0]),
    ];
    if (upd.length) await tx`
      UPDATE inventory_balance b SET on_hand_qty_boxes = v.q
      FROM unnest(${upd.map((u) => u[0])}::uuid[], ${upd.map((u) => u[1])}::int[]) AS v(id, q)
      WHERE b.lot_id = v.id AND b.tenant_id = ${tenantId}`;

    const led: [string, string, number][] = [
      ...plans.map((p): [string, string, number] => [lotOf.get(p)!, "import_snapshot", p.r.onHand! - (p.lot?.on_hand ?? 0)]),
      ...absent.map((l): [string, string, number] => [l.id, "import_snapshot_zero", -l.on_hand]),
    ].filter((x) => x[2] !== 0);
    if (led.length) await tx`
      INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, reference_type, reference_id, actor_user_id)
      SELECT ${tenantId}::uuid, l, t, d, 'import_batch', ${batch.id}::uuid, ${uploaderUserId}::uuid
      FROM unnest(${led.map((x) => x[0])}::uuid[], ${led.map((x) => x[1])}::text[], ${led.map((x) => x[2])}::int[]) AS x(l, t, d)`;

    await applyPalletDeltas(tx, tenantId, led.map((x) => ({ lotId: x[0], qty: x[2] })), "ایمپورت", uploaderUserId);

    await tx`
      INSERT INTO import_row (tenant_id, batch_id, row_number, raw_data, normalized_data, processing_status, matched_variant_id, matched_lot_id)
      SELECT ${tenantId}::uuid, ${batch.id}::uuid, n, r, nd, 'applied', v, l
      FROM unnest(${plans.map((p) => p.r.row)}::int[], ${plans.map((p) => JSON.stringify(p.raw))}::jsonb[],
                  ${plans.map((p) => JSON.stringify(p.r))}::jsonb[], ${plans.map(vid)}::uuid[], ${plans.map((p) => lotOf.get(p)!)}::uuid[])
        AS x(n, r, nd, v, l)`;

    // «موجود شد» فقط برای lotی که واقعاً بالا رفت، در همین تراکنش
    result.notified = await enqueueRestockNotifications(tx, tenantId,
      plans.filter((p) => p.r.onHand! > (p.lot?.on_hand ?? 0)).map((p) => lotOf.get(p)!));
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
      FROM inventory_balance WHERE tenant_id = ${tenantId} AND lot_id = ANY(${lotIds}::uuid[])
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

    if (bal.length) {
      const ids = bal.map((x) => x.lot_id), ds = bal.map((x) => dOf.get(x.lot_id)!);
      await tx`
        UPDATE inventory_balance b SET on_hand_qty_boxes = b.on_hand_qty_boxes - v.d
        FROM unnest(${ids}::uuid[], ${ds}::int[]) AS v(id, d)
        WHERE b.lot_id = v.id AND b.tenant_id = ${tenantId}`;
      await tx`
        INSERT INTO inventory_transaction (tenant_id, lot_id, transaction_type, on_hand_delta_boxes, reference_type, reference_id, actor_user_id)
        SELECT ${tenantId}::uuid, l, 'import_undo', -d, 'import_batch', ${batchId}::uuid, ${userId}::uuid
        FROM unnest(${ids}::uuid[], ${ds}::int[]) AS v(l, d)`;
      await applyPalletDeltas(tx, tenantId, bal.map((x) => ({ lotId: x.lot_id, qty: -dOf.get(x.lot_id)! })), "برگرداندنِ ایمپورت", userId);
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
