import { withTenant } from "./client";

export type Warehouse = { id: string; name: string; code: string; type: string };

export async function listWarehouses(tenantId: string): Promise<Warehouse[]> {
  return withTenant(tenantId, (tx) =>
    // «مدیریتِ همه‌ی انبارها»ست، نه جستجو — LIMIT فقط سقفِ دفاعی است.
    tx<Warehouse[]>`SELECT id, name, code, type FROM warehouse WHERE tenant_id = ${tenantId} ORDER BY name LIMIT 500`,
  );
}

export type CreateWarehouseResult = { ok: true; id: string } | { ok: false; reason: "code_taken" };

export async function createWarehouse(params: {
  tenantId: string; name: string; code: string; type: "main" | "regional" | "in_transit";
}): Promise<CreateWarehouseResult> {
  const { tenantId, name, code, type } = params;
  return withTenant(tenantId, async (tx) => {
    const [dup] = await tx<{ id: string }[]>`SELECT id FROM warehouse WHERE tenant_id = ${tenantId} AND code = ${code}`;
    if (dup) return { ok: false, reason: "code_taken" };
    const [w] = await tx<{ id: string }[]>`
      INSERT INTO warehouse (tenant_id, name, code, type) VALUES (${tenantId}, ${name}, ${code}, ${type}) RETURNING id`;
    return { ok: true, id: w.id };
  });
}

export type UpdateWarehouseResult = { ok: true } | { ok: false; reason: "code_taken" };

export async function updateWarehouse(params: {
  tenantId: string; warehouseId: string; name?: string; code?: string;
}): Promise<UpdateWarehouseResult> {
  const { tenantId, warehouseId } = params;
  return withTenant(tenantId, async (tx) => {
    if (params.code) {
      const [dup] = await tx<{ id: string }[]>`
        SELECT id FROM warehouse WHERE tenant_id = ${tenantId} AND code = ${params.code} AND id <> ${warehouseId}`;
      if (dup) return { ok: false, reason: "code_taken" };
    }
    await tx`
      UPDATE warehouse SET
        name = COALESCE(${params.name ?? null}, name),
        code = COALESCE(${params.code ?? null}, code)
      WHERE tenant_id = ${tenantId} AND id = ${warehouseId}`;
    return { ok: true };
  });
}

export type DeleteWarehouseResult = { ok: true } | { ok: false; reason: "has_history" };

/**
 * حذفِ واقعیِ انبار — فقط اگر هیچ سابقه‌ای ندارد. inventory_lot/sales_dispatch/
 * sales_dispatch_item/import_batch/incoming_stock همه بهش FK دارند، بدونِ
 * CASCADE؛ حذفِ انبارِ فعال یعنی از دست رفتنِ تاریخچه‌ی موجودی/حواله.
 */
export async function deleteWarehouse(params: { tenantId: string; warehouseId: string }): Promise<DeleteWarehouseResult> {
  const { tenantId, warehouseId } = params;
  return withTenant(tenantId, async (tx) => {
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT (
        (SELECT count(*) FROM inventory_lot WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}) +
        (SELECT count(*) FROM sales_dispatch WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}) +
        (SELECT count(*) FROM sales_dispatch_item WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId}) +
        (SELECT count(*) FROM import_batch WHERE tenant_id = ${tenantId} AND scope_warehouse_id = ${warehouseId}) +
        (SELECT count(*) FROM incoming_stock WHERE tenant_id = ${tenantId} AND warehouse_id = ${warehouseId})
      )::int AS n`;
    if (n > 0) return { ok: false, reason: "has_history" };

    await tx`DELETE FROM warehouse WHERE tenant_id = ${tenantId} AND id = ${warehouseId}`;
    return { ok: true };
  });
}
