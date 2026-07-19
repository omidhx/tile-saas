import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "@/db/client";
import { resetSchema } from "@/db/_testdb";
import { authorizeAgent, authorizeStaff, AuthzError } from "./authz";

// دو tenant. U = نماینده‌ی A (role agent). S = پشتیبانِ A (role staff).
const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const U = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const S = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const AG_A = "a5555555-5555-5555-5555-555555555555";
const AG_B = "b5555555-5555-5555-5555-555555555555";

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${A}','A','a'), ('${B}','B','b');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','0910','x'), ('${S}','0911','x');
    INSERT INTO tenant_membership (tenant_id,user_id,role,is_active) VALUES
      ('${A}','${U}','agent',true), ('${A}','${S}','staff',true);
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES
      ('${AG_A}','${A}','Ag A','AGA'), ('${AG_B}','${B}','Ag B','AGB');
    INSERT INTO agent_account_user (tenant_id,agent_account_id,user_id,role)
      VALUES ('${A}','${AG_A}','${U}','operator');
  `);
});

after(async () => { await sql.end(); });

test("دسترسی معتبر: کاربر A روی نمایندگیِ A → context با ttlHours", async () => {
  const ctx = await authorizeAgent(U, A, AG_A);
  assert.equal(ctx.tenantId, A);
  assert.equal(ctx.agentAccountId, AG_A);
  assert.equal(ctx.ttlHours, 24); // پیش‌فرض tenant
});

test("IDOR بین‌تننتی: کاربر A ادعای tenant B → رد (۴۰۳)", async () => {
  await assert.rejects(() => authorizeAgent(U, B, AG_B), AuthzError);
});

test("IDOR درون‌تننتی: کاربر A ادعای نمایندگیِ B → رد (وصل نیست)", async () => {
  await assert.rejects(() => authorizeAgent(U, A, AG_B), AuthzError);
});

test("authorizeStaff: پشتیبان (role staff) مجاز است", async () => {
  const ctx = await authorizeStaff(S, A);
  assert.equal(ctx.role, "staff");
});

test("authorizeStaff: نماینده (role agent) رد می‌شود (تأیید/حواله کارِ staff است)", async () => {
  await assert.rejects(() => authorizeStaff(U, A), AuthzError);
});

test("authorizeStaff: غیرعضو رد می‌شود", async () => {
  await assert.rejects(() => authorizeStaff(S, B), AuthzError);
});
