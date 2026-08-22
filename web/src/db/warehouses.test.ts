import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { createWarehouse, updateWarehouse, listWarehouses, deleteWarehouse } from "./warehouses";
import { T, seedTenant } from "./_fixtures";

before(async () => {
  await resetSchema();
  await seedTenant();
});
after(async () => { await sql.end(); });

test("createWarehouse: ساخته می‌شود و در فهرست دیده می‌شود", async () => {
  const r = await createWarehouse({ tenantId: T, name: "انبار جدید", code: "W-NEW", type: "regional" });
  assert.equal(r.ok, true);
  const list = await listWarehouses(T);
  assert.ok(list.some((w) => w.code === "W-NEW" && w.name === "انبار جدید"));
});

test("createWarehouse: کدِ تکراری رد می‌شود", async () => {
  await createWarehouse({ tenantId: T, name: "یک", code: "W-DUP", type: "main" });
  const r2 = await createWarehouse({ tenantId: T, name: "دو", code: "W-DUP", type: "main" });
  assert.deepEqual(r2, { ok: false, reason: "code_taken" });
});

test("updateWarehouse: تغییرِ نام بدونِ دست‌زدن به کد", async () => {
  const created = await createWarehouse({ tenantId: T, name: "قبلی", code: "W-REN", type: "main" });
  const id = created.ok ? created.id : "";
  await updateWarehouse({ tenantId: T, warehouseId: id, name: "بعدی" });
  const list = await listWarehouses(T);
  const w = list.find((x) => x.id === id);
  assert.equal(w?.name, "بعدی");
  assert.equal(w?.code, "W-REN");
});

test("deleteWarehouse: انبارِ نو (بدونِ سابقه) واقعاً حذف می‌شود", async () => {
  const created = await createWarehouse({ tenantId: T, name: "تازه", code: "W-FRESH", type: "regional" });
  const id = created.ok ? created.id : "";
  const r = await deleteWarehouse({ tenantId: T, warehouseId: id });
  assert.equal(r.ok, true);
  assert.ok(!(await listWarehouses(T)).some((w) => w.id === id));
});

test("deleteWarehouse: انبارِ سابقه‌دار (موجودی دارد) حذف نمی‌شود", async () => {
  const created = await createWarehouse({ tenantId: T, name: "پرموجودی", code: "W-HIST", type: "main" });
  const id = created.ok ? created.id : "";
  await sql.unsafe(`
    INSERT INTO product (id,tenant_id,code,name) VALUES ('a1111111-1111-1111-1111-111111111199','${T}','P99','P99');
    INSERT INTO product_variant (id,tenant_id,product_id,sku) VALUES
      ('a2222222-2222-2222-2222-222222222299','${T}','a1111111-1111-1111-1111-111111111199','S99');
    INSERT INTO inventory_lot (id,tenant_id,variant_id,warehouse_id) VALUES
      ('a4444444-4444-4444-4444-444444444499','${T}','a2222222-2222-2222-2222-222222222299','${id}');
  `);
  const r = await deleteWarehouse({ tenantId: T, warehouseId: id });
  assert.deepEqual(r, { ok: false, reason: "has_history" });
  assert.ok((await listWarehouses(T)).some((w) => w.id === id), "انبار باید سرِجایش مانده باشد");
});
