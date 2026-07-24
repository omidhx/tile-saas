import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { createAgent, updateAgent, addAgentUser, listAgentsFull, deleteAgent } from "./agents";

/**
 * ساختِ نمایندگی + کاربرِ اولش (v3، ادمینِ کارخانه به‌جای SQL دستی).
 * قاعده‌های اصلی: سقفِ اشتراک (max_agents)، کدِ تکراری، و find-or-create روی
 * کاربرِ سراسری (شماره‌ی تکراری = همان حساب، نه دو تا).
 */

const T = "11111111-1111-1111-1111-111111111111";

before(async () => {
  await resetSchema();
  await sql.unsafe(`INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');`);
});
after(async () => { await sql.end(); });

test("createAgent: نمایندگیِ تازه با کاربرِ تازه — رمزِ یک‌بارمصرف ساخته می‌شود", async () => {
  const r = await createAgent({
    tenantId: T, legalName: "نمایندگی تهران", code: "AG-THR", firstUserPhone: "09121110001",
  });
  assert.equal(r.ok, true);
  const [agents] = [await listAgentsFull(T)];
  const a = agents.find((x) => x.code === "AG-THR");
  assert.ok(a);
  assert.equal(a!.users.length, 1);
  assert.equal(a!.users[0].phone, "09121110001");
});

test("createAgent: شماره‌ی تکراری همان کاربر را دوباره استفاده می‌کند (نه ساختِ کاربرِ دوم)", async () => {
  await createAgent({ tenantId: T, legalName: "الف", code: "AG-DUP1", firstUserPhone: "09121110002" });
  await createAgent({ tenantId: T, legalName: "ب", code: "AG-DUP2", firstUserPhone: "09121110002" });
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM app_user WHERE phone = '09121110002'`;
  assert.equal(n, 1, "باید فقط یک app_user برای این شماره وجود داشته باشد");
  const [{ n: links }] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM agent_account_user aau
    JOIN app_user u ON u.id = aau.user_id WHERE u.phone = '09121110002'`;
  assert.equal(links, 2, "همان کاربر باید به هر دو نمایندگی وصل شده باشد");
});

test("createAgent: کدِ تکراری در همان tenant رد می‌شود", async () => {
  await createAgent({ tenantId: T, legalName: "ج", code: "AG-SAME", firstUserPhone: "09121110003" });
  const r2 = await createAgent({ tenantId: T, legalName: "د", code: "AG-SAME", firstUserPhone: "09121110004" });
  assert.deepEqual(r2, { ok: false, reason: "code_taken" });
});

test("createAgent: بعد از رسیدن به max_agents رد می‌شود", async () => {
  const T2 = "22222222-2222-2222-2222-222222222222";
  await sql.unsafe(`INSERT INTO tenant (id,name,slug,max_agents) VALUES ('${T2}','B','b',1);`);
  const ok1 = await createAgent({ tenantId: T2, legalName: "اول", code: "AG-1", firstUserPhone: "09121110005" });
  assert.equal(ok1.ok, true);
  const ok2 = await createAgent({ tenantId: T2, legalName: "دوم", code: "AG-2", firstUserPhone: "09121110006" });
  assert.deepEqual(ok2, { ok: false, reason: "seat_limit" });
});

test("updateAgent: priceListId را می‌شود صریحاً به NULL برگرداند", async () => {
  const pl = "aaaa2222-2222-2222-2222-222222222222";
  await sql.unsafe(`INSERT INTO price_list (id,tenant_id,name) VALUES ('${pl}','${T}','لیستِ خاص');`);
  const created = await createAgent({
    tenantId: T, legalName: "قیمت‌دار", code: "AG-PL", firstUserPhone: "09121110007", priceListId: pl,
  });
  assert.equal(created.ok, true);
  const id = created.ok ? created.agentAccountId : "";

  await updateAgent({ tenantId: T, agentAccountId: id, priceListId: pl });
  let [row] = await sql<{ price_list_id: string | null }[]>`SELECT price_list_id FROM agent_account WHERE id = ${id}`;
  assert.equal(row.price_list_id, pl);

  await updateAgent({ tenantId: T, agentAccountId: id, priceListId: null });
  [row] = await sql<{ price_list_id: string | null }[]>`SELECT price_list_id FROM agent_account WHERE id = ${id}`;
  assert.equal(row.price_list_id, null, "priceListId: null باید واقعاً NULL کند، نه بی‌اثر بماند");
});

test("addAgentUser: افزودنِ کاربرِ دوم به همان نمایندگی، و رد کردنِ افزودنِ تکراری", async () => {
  const created = await createAgent({ tenantId: T, legalName: "دونفره", code: "AG-TWO", firstUserPhone: "09121110008" });
  const id = created.ok ? created.agentAccountId : "";
  const add = await addAgentUser({ tenantId: T, agentAccountId: id, phone: "09121110009" });
  assert.equal(add.ok, true);
  const dup = await addAgentUser({ tenantId: T, agentAccountId: id, phone: "09121110009" });
  assert.deepEqual(dup, { ok: false, reason: "already_linked" });
});

test("deleteAgent: نمایندگیِ نو (بدونِ سابقه) واقعاً حذف می‌شود، همراهِ لینکِ کاربرش", async () => {
  const created = await createAgent({ tenantId: T, legalName: "تازه", code: "AG-FRESH", firstUserPhone: "09121110010" });
  const id = created.ok ? created.agentAccountId : "";
  const r = await deleteAgent({ tenantId: T, agentAccountId: id });
  assert.equal(r.ok, true);
  assert.ok(!(await listAgentsFull(T)).some((a) => a.id === id));
  const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM agent_account_user WHERE agent_account_id = ${id}`;
  assert.equal(n, 0, "لینکِ کاربر هم باید پاک شده باشد");
});

test("deleteAgent: نمایندگیِ سابقه‌دار (مشتری وصل) حذف نمی‌شود", async () => {
  const created = await createAgent({ tenantId: T, legalName: "سابقه‌دار", code: "AG-HIST", firstUserPhone: "09121110011" });
  const id = created.ok ? created.agentAccountId : "";
  await sql.unsafe(`INSERT INTO customer (tenant_id, agent_account_id, name) VALUES ('${T}', '${id}', 'مشتریِ آزمایشی');`);
  const r = await deleteAgent({ tenantId: T, agentAccountId: id });
  assert.deepEqual(r, { ok: false, reason: "has_history" });
  assert.ok((await listAgentsFull(T)).some((a) => a.id === id), "نمایندگی باید سرِجایش مانده باشد");
});
