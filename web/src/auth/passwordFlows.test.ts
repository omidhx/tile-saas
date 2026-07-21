import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sql } from "@/db/client";
import { resetSchema } from "@/db/_testdb";
import { hashPassword, verifyPassword } from "./password";
import { changePassword, requestReset, confirmReset, MIN_PASSWORD } from "./passwordFlows";

/**
 * مسیرِ اعتبارنامه. تست‌ها عمداً روی **راه‌های شکست** تمرکز دارند نه حالتِ خوش:
 * اینجا هر سوراخ یعنی کسی به حسابِ نماینده‌ی دیگر می‌رسد.
 */

const T = "11111111-1111-1111-1111-111111111111";
const U = "a8888888-8888-8888-8888-888888888888";
const OTHER = "a8888888-8888-8888-8888-888888888889";
const PHONE = "09120000000";
const OLD = "oldpass123";

before(async () => {
  await resetSchema();
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');
    INSERT INTO app_user (id,phone,password_hash) VALUES
      ('${U}','${PHONE}','x'), ('${OTHER}','09120000009','x');
    INSERT INTO tenant_membership (tenant_id,user_id,role) VALUES ('${T}','${U}','agent');
  `);
});
after(async () => { await sql.end(); });

// هر تست از رمزِ معلوم و بدونِ کدِ باز شروع می‌شود
beforeEach(async () => {
  await sql`UPDATE app_user SET password_hash = ${await hashPassword(OLD)},
            sessions_valid_from = date_trunc('second', now() - interval '1 hour') WHERE id = ${U}`;
  await sql`DELETE FROM password_reset`;
  await sql`DELETE FROM notification_outbox`;
});

const currentHash = async () =>
  (await sql<{ password_hash: string }[]>`SELECT password_hash FROM app_user WHERE id = ${U}`)[0].password_hash;
const validFrom = async () =>
  (await sql<{ v: Date }[]>`SELECT sessions_valid_from AS v FROM app_user WHERE id = ${U}`)[0].v;

// ---------------------------------------------------------------- تغییر رمز

test("تغییر رمز با رمز فعلیِ درست کار می‌کند", async () => {
  const r = await changePassword({ userId: U, currentPassword: OLD, newPassword: "brandnew123" });
  assert.ok(r.ok);
  assert.ok(await verifyPassword("brandnew123", await currentHash()));
});

test("رمز فعلیِ غلط → رد، و رمز دست‌نخورده می‌ماند", async () => {
  const before = await currentHash();
  const r = await changePassword({ userId: U, currentPassword: "wrong", newPassword: "brandnew123" });
  assert.deepEqual(r, { ok: false, reason: "wrong_current" });
  assert.equal(await currentHash(), before, "رمز نباید عوض شده باشد");
});

test("رمزِ کوتاه رد می‌شود — قبل از هر کارِ دیگری", async () => {
  const r = await changePassword({ userId: U, currentPassword: OLD, newPassword: "a".repeat(MIN_PASSWORD - 1) });
  assert.deepEqual(r, { ok: false, reason: "too_short" });
});

test("رمز جدید نباید همان رمز فعلی باشد", async () => {
  const r = await changePassword({ userId: U, currentPassword: OLD, newPassword: OLD });
  assert.deepEqual(r, { ok: false, reason: "same_as_current" });
});

test("🔴 تغییر رمز همه‌ی نشست‌ها را باطل می‌کند", async () => {
  const before = await validFrom();
  await changePassword({ userId: U, currentPassword: OLD, newPassword: "brandnew123" });
  const after = await validFrom();
  assert.ok(after.getTime() > before.getTime(),
    "بدون این، نشستِ دزدیده‌شده روی دستگاهِ دیگر تا ۷ روز زنده می‌ماند و تغییرِ رمز بی‌اثر است");
});

test("تغییر رمز، کدهای بازیابیِ در جریان را هم می‌سوزاند", async () => {
  const { code } = await requestReset(PHONE);
  await changePassword({ userId: U, currentPassword: OLD, newPassword: "brandnew123" });

  const r = await confirmReset({ phone: PHONE, code: code!, newPassword: "attacker99" });
  assert.deepEqual(r, { ok: false, reason: "invalid_code" },
    "کدِ SMSیِ قبل از تغییرِ رمز نباید هنوز کار کند");
});

// ------------------------------------------------------------ بازیابی رمز

test("درخواستِ بازیابی برای شماره‌ی ناموجود، وجود/نبودِ کاربر را لو نمی‌دهد", async () => {
  const real = await requestReset(PHONE);
  const fake = await requestReset("09999999999");
  assert.ok(real.code, "برای کاربرِ واقعی کد ساخته می‌شود");
  assert.equal(fake.code, null, "برای شماره‌ی ناموجود هیچ — ولی تابع خطا هم نمی‌دهد");
  // خروجیِ عمومیِ هر دو یکی است: هیچ‌کدام throw نکردند و چیزی برنگرداندند که فرق کند
});

test("کد در همان تراکنش به Outbox می‌رود (پیامک)", async () => {
  const { code } = await requestReset(PHONE);
  const [msg] = await sql<{ recipient: string; payload: { type: string; code: string } }[]>`
    SELECT recipient, payload FROM notification_outbox`;
  assert.equal(msg.recipient, PHONE);
  assert.equal(msg.payload.type, "password_reset");
  assert.equal(msg.payload.code, code);
});

test("کدِ درست رمز را عوض می‌کند و نشست‌ها را می‌کشد", async () => {
  const before = await validFrom();
  const { code } = await requestReset(PHONE);
  const r = await confirmReset({ phone: PHONE, code: code!, newPassword: "resetpass123" });
  assert.ok(r.ok);
  assert.ok(await verifyPassword("resetpass123", await currentHash()));
  assert.ok((await validFrom()).getTime() > before.getTime(), "بازیابی هم باید نشست‌ها را باطل کند");
});

test("کد یک‌بارمصرف است", async () => {
  const { code } = await requestReset(PHONE);
  assert.ok((await confirmReset({ phone: PHONE, code: code!, newPassword: "first12345" })).ok);
  const second = await confirmReset({ phone: PHONE, code: code!, newPassword: "second12345" });
  assert.deepEqual(second, { ok: false, reason: "invalid_code" });
  assert.ok(await verifyPassword("first12345", await currentHash()), "رمزِ دوم نباید اعمال شده باشد");
});

test("درخواستِ دوباره، کدِ قبلی را باطل می‌کند", async () => {
  const first = await requestReset(PHONE);
  const second = await requestReset(PHONE);
  assert.notEqual(first.code, second.code);
  assert.deepEqual(await confirmReset({ phone: PHONE, code: first.code!, newPassword: "viaold12345" }),
    { ok: false, reason: "invalid_code" }, "فقط آخرین کد باید کار کند");
  assert.ok((await confirmReset({ phone: PHONE, code: second.code!, newPassword: "vianew12345" })).ok);
});

test("کدِ منقضی رد می‌شود", async () => {
  const { code } = await requestReset(PHONE);
  await sql`UPDATE password_reset SET created_at = now() - interval '2 hours',
            expires_at = now() - interval '1 minute'`;
  assert.deepEqual(await confirmReset({ phone: PHONE, code: code!, newPassword: "expired12345" }),
    { ok: false, reason: "invalid_code" });
});

test("🔴 حدسِ پیاپی بعد از ۵ تلاش کد را می‌سوزاند", async () => {
  const { code } = await requestReset(PHONE);
  for (let i = 0; i < 5; i++) {
    const r = await confirmReset({ phone: PHONE, code: "000000", newPassword: "guessed12345" });
    assert.deepEqual(r, { ok: false, reason: "invalid_code" }, `تلاش ${i + 1}`);
  }
  // تلاشِ ششم حتی با کدِ **درست** هم باید رد شود
  const after = await confirmReset({ phone: PHONE, code: code!, newPassword: "guessed12345" });
  assert.deepEqual(after, { ok: false, reason: "too_many_attempts" },
    "کدِ شش‌رقمی با ۱۰ دقیقه فرصت وگرنه قابلِ جست‌وجوی کامل است");
});

test("کدِ کاربرِ دیگر روی این حساب کار نمی‌کند", async () => {
  const mine = await requestReset(PHONE);
  // برای کاربرِ دوم عضویت نداریم، پس مستقیم کد می‌سازیم تا شرایط واقعی شبیه‌سازی شود
  await sql`INSERT INTO password_reset (user_id, code_hash, expires_at)
            VALUES (${OTHER}, encode(sha256('123456'::bytea),'hex'), now() + interval '10 min')`;
  assert.deepEqual(await confirmReset({ phone: PHONE, code: "123456", newPassword: "crossuser123" }),
    { ok: false, reason: "invalid_code" }, "کد باید به کاربر گره خورده باشد");
  assert.ok((await confirmReset({ phone: PHONE, code: mine.code!, newPassword: "ownuser12345" })).ok);
});

test("رمزِ کوتاه در مسیرِ بازیابی هم رد می‌شود، و کد را نمی‌سوزاند", async () => {
  const { code } = await requestReset(PHONE);
  assert.deepEqual(await confirmReset({ phone: PHONE, code: code!, newPassword: "short" }),
    { ok: false, reason: "too_short" });
  assert.ok((await confirmReset({ phone: PHONE, code: code!, newPassword: "longenough123" })).ok,
    "کاربری که رمزِ کوتاه زد نباید مجبور شود کدِ تازه بگیرد");
});
