import { test, before } from "node:test";
import assert from "node:assert/strict";
import { sql } from "./_testdb";
import { resetSchema } from "./_testdb";
import { inviteTeamMember, setTeamMember, listTeam, deleteTeamMember } from "./team";
import { T, seedTenant } from "./_fixtures";

/**
 * دعوتِ عضوِ تیمِ پشتیبان/مدیر (v3). قاعده‌های اصلی: سقفِ اشتراک (max_staff)،
 * find-or-create روی کاربرِ سراسری، و گاردِ «حداقل یک adminِ فعال».
 */

const U_ADMIN = "55555555-5555-5555-5555-555555555556";

before(async () => {
  await resetSchema();
  await seedTenant();
  await sql.unsafe(`
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U_ADMIN}','09120000001','x');
    INSERT INTO tenant_membership (tenant_id,user_id,role,is_active) VALUES ('${T}','${U_ADMIN}','admin',true);
  `);
});

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

test("deleteTeamMember: عضوِ عادی حذف می‌شود؛ آخرین admin و کاربرِ وصل به نمایندگی رد می‌شوند", async () => {
  const T4 = "55555555-4444-4444-4444-444444444444";
  const AG = "a5555555-5555-5555-5555-555555555599";
  await sql.unsafe(`INSERT INTO tenant (id,name,slug) VALUES ('${T4}','E','e');`);
  await inviteTeamMember({ tenantId: T4, phone: "09130000010", role: "admin" });
  await inviteTeamMember({ tenantId: T4, phone: "09130000011", role: "staff" });
  const members = await listTeam(T4);
  const admin = members.find((m) => m.phone === "09130000010")!;
  const staff = members.find((m) => m.phone === "09130000011")!;

  // آخرین admin قابلِ حذف نیست
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

// ── فاز ۴ ────────────────────────────────────────────────────────────────

test("فاز ۴: دعوت روی کاربرِ موجودِ tenantِ دیگر ایمیل نمی‌گذارد (تصاحبِ حساب از راهِ بازیابی رمز)", async () => {
  const TC = "c3333333-3333-3333-3333-333333333333";
  const VICTIM = "c5555555-5555-5555-5555-555555555555";
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${TC}','کارخانه‌ی دیگر','other');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${VICTIM}','09135550001','x');
    INSERT INTO tenant_membership (tenant_id,user_id,role,is_active) VALUES ('${TC}','${VICTIM}','admin',true);
  `);
  // مدیرِ T عضوِ TC نیست، ولی شماره‌ی مدیرِ TC را با ایمیلِ خودش دعوت می‌کند
  const r = await inviteTeamMember({
    tenantId: T, phone: "09135550001", email: "chosen-by-attacker@elsewhere.test", fullName: "اسمِ جعلی", role: "staff",
  });
  assert.equal(r.ok && r.created, false);
  const [u] = await sql<{ email: string | null; full_name: string | null }[]>`
    SELECT email, full_name FROM app_user WHERE id = ${VICTIM}`;
  assert.equal(u.email, null, "ایمیلِ حسابِ موجود نباید از مسیرِ دعوت عوض شود");
  assert.equal(u.full_name, null, "نامِ حسابِ موجود هم نباید از مسیرِ دعوت عوض شود");
});

test("فاز ۴: پیامکِ دعوت شیءِ JSON است و متنش نام کاربری و رمز را دارد", async () => {
  const { renderMessage } = await import("@/notify/sender");
  const r = await inviteTeamMember({ tenantId: T, phone: "09135550002", role: "staff" });
  assert.ok(r.ok && r.tempPassword);
  const [row] = await sql<{ kind: string; payload: Record<string, unknown> }[]>`
    SELECT jsonb_typeof(payload) AS kind, payload FROM notification_outbox
    WHERE recipient = '09135550002'`;
  assert.equal(row.kind, "object", "payload رشته‌ی jsonb ذخیره شده، نه شیء");
  const text = renderMessage(row.payload);
  assert.ok(text.includes("09135550002") && text.includes(r.tempPassword!), `متنِ پیامک: ${text}`);
});

test("فاز ۴: setTeamMember روی عضوِ ناموجود not_found می‌دهد، نه TypeError", async () => {
  const r = await setTeamMember({ tenantId: T, membershipId: "99999999-9999-9999-9999-999999999999", fullName: "x" });
  assert.deepEqual(r, { ok: false, reason: "not_found" });
});

test("فاز ۴: migration 0008 ردیف‌های صف‌شده با payloadِ رشته‌ای را به شیء برمی‌گرداند", async () => {
  const { readFileSync } = await import("node:fs");
  const body = { type: "team_invite", tenantName: "A", identifier: "09135550003", tempPassword: "Tmp-123" };
  // همان شکلی که کدِ قبلی می‌نوشت: رشته‌ی jsonb
  await sql`INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
            VALUES (${T}, 'sms', '09135550003', to_jsonb(${JSON.stringify(body)}::text))`;
  const migration = readFileSync(new URL("../../../db/migrations/0008_outbox_payload_unwrap.sql", import.meta.url), "utf8")
    .replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
  await sql.unsafe(migration);
  await sql.unsafe(migration); // دوباره: بی‌اثر
  const [row] = await sql<{ kind: string; payload: Record<string, unknown> }[]>`
    SELECT jsonb_typeof(payload) AS kind, payload FROM notification_outbox WHERE recipient = '09135550003'`;
  assert.equal(row.kind, "object");
  assert.deepEqual(row.payload, body);
});
