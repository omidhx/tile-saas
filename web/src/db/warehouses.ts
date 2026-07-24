import { withTenant } from "./client";

export type Warehouse = { id: string; name: string; code: string; type: string };

export async function listWarehouses(tenantId: string): Promise<Warehouse[]> {
  return withTenant(tenantId, (tx) =>
    tx<Warehouse[]>`SELECT id, name, code, type FROM warehouse WHERE tenant_id = ${tenantId} ORDER BY name`,
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

/** فقط تغییرِ نام/کد — انبار «حذف» نمی‌شود چون inventory_lot بهش FK دارد (بخشِ حذف عمداً نیست). */
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
