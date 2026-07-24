import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { inviteTeamMember, setTeamMember, listTeam } from "./team";

/**
 * دعوتِ عضوِ تیمِ پشتیبان/مدیر (v3). قاعده‌های اصلی: سقفِ اشتراک (max_staff)،
 * find-or-create روی کاربرِ سراسری، و گاردِ «حداقل یک adminِ فعال».
 */

const T = "11111111-1111-1111-1111-111111111111";
const U_ADMIN = "55555555-5555-5555-5555-555555555556";

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U_ADMIN}','09120000001','x');
    INSERT INTO tenant_membership (tenant_id,user_id,role,is_active) VALUES ('${T}','${U_ADMIN}','admin',true);
  `);
});
after(async () => { await sql.end(); });

test("inviteTeamMember: کاربرِ تازه با موبایل — رمزِ یک‌بارمصرف ساخته می‌شود", async () => {
  const r = await inviteTeamMember({ tenantId: T, phone: "09130000001", role: "staff" });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.created, true);
  const members = await listTeam(T);
  assert.ok(members.some((m) => m.phone === "09130000001" && m.role === "staff"));
});

test("inviteTeamMember: دعوتِ دوباره‌ی همان عضوِ فعال رد می‌شود", async () => {
  await inviteTeamMember({ tenantId: T, phone: "09130000002", role: "staff" });
  const again = await inviteTeamMember({ tenantId: T, phone: "09130000002", role: "admin" });
  assert.deepEqual(again, { ok: false, reason: "already_member" });
});

test("inviteTeamMember: بعد از رسیدن به max_staff رد می‌شود", async () => {
  const T2 = "33333333-3333-3333-3333-333333333333";
  // ۱ صندلیِ آزاد: خودِ ادمینِ زیر همین تننت شمرده می‌شود
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug,max_staff) VALUES ('${T2}','C','c',1);
    INSERT INTO tenant_membership (tenant_id,user_id,role,is_active) VALUES ('${T2}','${U_ADMIN}','admin',true);
  `);
  const r = await inviteTeamMember({ tenantId: T2, phone: "09130000003", role: "staff" });
  assert.deepEqual(r, { ok: false, reason: "seat_limit" });
});

test("setTeamMember: غیرفعال‌کردنِ تنها adminِ فعال رد می‌شود", async () => {
  const members = await listTeam(T);
  const admin = members.find((m) => m.userId === U_ADMIN)!;
  const r = await setTeamMember({ tenantId: T, membershipId: admin.membershipId, isActive: false });
  assert.deepEqual(r, { ok: false, reason: "last_admin" });
});

test("setTeamMember: با دو admin، غیرفعال‌کردنِ یکی مجاز است", async () => {
  await inviteTeamMember({ tenantId: T, phone: "09130000004", role: "admin" });
  const members = await listTeam(T);
  const second = members.find((m) => m.phone === "09130000004")!;
  const r = await setTeamMember({ tenantId: T, membershipId: second.membershipId, isActive: false });
  assert.equal(r.ok, true);
});
