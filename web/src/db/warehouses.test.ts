import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { createWarehouse, updateWarehouse, listWarehouses } from "./warehouses";

const T = "11111111-1111-1111-1111-111111111111";

before(async () => {
  await resetSchema();
  await sql.unsafe(`INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');`);
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
