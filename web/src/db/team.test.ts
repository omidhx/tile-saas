import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./client";
import { resetSchema } from "./_testdb";
import { inviteTeamMember, setTeamMember, listTeam, deleteTeamMember } from "./team";

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

test("v4: allowedPages فقط برای role=staff ذخیره می‌شود، برای admin نادیده گرفته می‌شود", async () => {
  await inviteTeamMember({ tenantId: T, phone: "09130000005", role: "staff", allowedPages: ["prices", "customers"] });
  const staffMember = (await listTeam(T)).find((m) => m.phone === "09130000005")!;
  assert.deepEqual(staffMember.allowedPages, ["prices", "customers"]);

  await inviteTeamMember({ tenantId: T, phone: "09130000006", role: "admin", allowedPages: ["prices"] });
  const adminMember = (await listTeam(T)).find((m) => m.phone === "09130000006")!;
  assert.deepEqual(adminMember.allowedPages, [], "admin نباید allowedPages بگیرد حتی اگر فرم فرستاده باشد");
});

test("v4: صفحه‌ی نامعتبر در allowedPages فیلتر می‌شود (فقط از STAFF_PAGE_KEYS)", async () => {
  await inviteTeamMember({ tenantId: T, phone: "09130000007", role: "staff", allowedPages: ["prices", "hack-page"] });
  const m = (await listTeam(T)).find((x) => x.phone === "09130000007")!;
  assert.deepEqual(m.allowedPages, ["prices"]);
});

test("v4: تنها معاونِ مدیرِ فعال قابلِ تنزل/غیرفعال‌شدن نیست (last_deputy)", async () => {
  const T3 = "44444444-4444-4444-4444-444444444444";
  await sql.unsafe(`INSERT INTO tenant (id,name,slug) VALUES ('${T3}','D','d');`);
  await inviteTeamMember({ tenantId: T3, phone: "09130000008", role: "admin", canManageAccess: true });
  const deputy = (await listTeam(T3)).find((m) => m.phone === "09130000008")!;

  const demote = await setTeamMember({ tenantId: T3, membershipId: deputy.membershipId, canManageAccess: false });
  assert.deepEqual(demote, { ok: false, reason: "last_deputy" });

  // غیرفعال‌کردن هم آخرین admin هم آخرین معاون را می‌برد — last_admin مرزِ بنیادی‌تری است
  const deactivate = await setTeamMember({ tenantId: T3, membershipId: deputy.membershipId, isActive: false });
  assert.deepEqual(deactivate, { ok: false, reason: "last_admin" });

  // با یک معاونِ دومی، تنزلِ اولی مجاز می‌شود
  await inviteTeamMember({ tenantId: T3, phone: "09130000009", role: "admin", canManageAccess: true });
  const ok = await setTeamMember({ tenantId: T3, membershipId: deputy.membershipId, canManageAccess: false });
  assert.equal(ok.ok, true);
});

test("deleteTeamMember: عضوِ عادی حذف می‌شود؛ آخرین admin و کاربرِ وصل به نمایندگی رد می‌شوند", async () => {
  const T4 = "55555555-4444-4444-4444-444444444444";
  const AG = "a5555555-5555-5555-5555-555555555599";
  await sql.unsafe(`INSERT INTO tenant (id,name,slug) VALUES ('${T4}','E','e');`);
  await inviteTeamMember({ tenantId: T4, phone: "09130000010", role: "admin", canManageAccess: true });
  await inviteTeamMember({ tenantId: T4, phone: "09130000011", role: "staff" });
  const members = await listTeam(T4);
  const admin = members.find((m) => m.phone === "09130000010")!;
  const staff = members.find((m) => m.phone === "09130000011")!;

  // آخرین admin/معاون قابلِ حذف نیست
  const delAdmin = await deleteTeamMember({ tenantId: T4, membershipId: admin.membershipId });
  assert.deepEqual(delAdmin, { ok: false, reason: "last_admin" });

  // کاربرِ وصل به نمایندگی، اول باید جدا شود
  await sql.unsafe(`
    INSERT INTO agent_account (id,tenant_id,legal_name,code) VALUES ('${AG}','${T4}','Ag','AGX');
    UPDATE tenant_membership SET role = 'agent' WHERE id = '${staff.membershipId}';
    INSERT INTO agent_account_user (tenant_id,agent_account_id,user_id,role) VALUES ('${T4}','${AG}','${staff.userId}','op');
  `);
  const delLinked = await deleteTeamMember({ tenantId: T4, membershipId: staff.membershipId });
  assert.deepEqual(delLinked, { ok: false, reason: "linked_to_agent" });

  // عضوِ عادیِ آزاد، واقعاً حذف می‌شود
  await inviteTeamMember({ tenantId: T4, phone: "09130000012", role: "staff" });
  const freeMember = (await listTeam(T4)).find((m) => m.phone === "09130000012")!;
  const del = await deleteTeamMember({ tenantId: T4, membershipId: freeMember.membershipId });
  assert.equal(del.ok, true);
  assert.ok(!(await listTeam(T4)).some((m) => m.phone === "09130000012"));
});
