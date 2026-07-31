import { createHash, randomInt, randomUUID } from "node:crypto";
import { sql, withTenant } from "@/db/client";
import { hashPassword, verifyPassword } from "./password";
import { invalidateSessionsIn } from "./session";

/**
 * تغییر و بازیابیِ رمز عبور.
 *
 * سه قاعده‌ای که همه‌جای این فایل تکرار می‌شوند:
 *   ۱. هر تغییرِ رمز، **همه‌ی نشست‌ها را باطل می‌کند** و در همان تراکنش. اگر جدا بود،
 *      پنجره‌ای می‌ماند که رمز عوض شده ولی نشستِ مهاجم هنوز زنده است.
 *   ۲. مسیرِ بازیابی **وجودِ شماره را لو نمی‌دهد**: پاسخ چه کاربر باشد چه نباشد یکی است.
 *      وگرنه این endpoint به ابزارِ شمارشِ شماره‌های نمایندگان تبدیل می‌شود.
 *   ۳. کدِ بازیابی یک اعتبارنامه است، پس **hash** ذخیره می‌شود نه خودش.
 */

import { MIN_PASSWORD } from "./passwordFlows.shared";
export { MIN_PASSWORD };
const CODE_TTL_MIN = 10;
const MAX_CODE_ATTEMPTS = 5;

export type PasswordError =
  | "wrong_current"      // رمز فعلی غلط
  | "too_short"          // رمز جدید کوتاه
  | "same_as_current"    // رمز جدید = رمز فعلی
  | "invalid_code"       // کد اشتباه/منقضی/مصرف‌شده
  | "too_many_attempts"; // تلاشِ بیش از حد روی همان کد

export type Result = { ok: true } | { ok: false; reason: PasswordError };

/** کد فقط hash ذخیره می‌شود. SHA-256 کافی است: کد شش‌رقمیِ ۱۰ دقیقه‌ای است، نه رمزِ ماندگار. */
const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

function validateNew(newPassword: string): PasswordError | null {
  if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD) return "too_short";
  return null;
}

/**
 * شکلِ رفت‌وبرگشتِ DBِ مسیرِ واقعی را کپی می‌کند (نه محتوایش) — قاعده‌ی ۲ فقط پاسخ
 * را یکسان می‌کرد، نه زمانِ رسیدنش؛ «شناسه وجود ندارد» صفر کوئریِ اضافه می‌زد و
 * «وجود دارد» چند کوئری/تراکنش، که خودش یک کانالِ زمان‌بندی برای شمارشِ شماره
 * می‌سازد. با tenantId/userId جعلی — RLS چیزی برنمی‌گرداند، FK هم با
 * `WHERE false` هرگز لمس نمی‌شود، فقط هزینه‌ی رفت‌وبرگشت باقی می‌ماند.
 */
async function dummyResetWork() {
  const fake = randomUUID();
  await sql`SELECT 1 FROM user_contexts(${randomUUID()}) LIMIT 1`;
  await withTenant(randomUUID(), async (tx) => {
    await tx`UPDATE password_reset SET used_at = now() WHERE user_id = ${fake} AND used_at IS NULL`;
    await tx`INSERT INTO password_reset (user_id, code_hash, expires_at)
             SELECT ${fake}, ${hashCode("000000")}, now() WHERE false`;
    await tx`INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
             SELECT ${fake}, 'sms', 'x', '{}'::jsonb WHERE false`;
  });
}

async function dummyConfirmWork() {
  await sql.begin(async (tx) => {
    await tx`SELECT id, code_hash, attempt_count FROM password_reset
             WHERE user_id = ${randomUUID()} AND used_at IS NULL AND expires_at > now()
             ORDER BY created_at DESC LIMIT 1 FOR UPDATE`;
  });
}

/** تغییر رمز توسط کاربرِ واردشده (رمز فعلی لازم است). */
export async function changePassword(p: {
  userId: string; currentPassword: string; newPassword: string;
}): Promise<Result> {
  const bad = validateNew(p.newPassword);
  if (bad) return { ok: false, reason: bad };

  const [u] = await sql<{ password_hash: string }[]>`
    SELECT password_hash FROM app_user WHERE id = ${p.userId} AND is_active`;
  // کاربرِ ناموجود همان پاسخِ «رمز فعلی غلط» را می‌گیرد — تمایزی برای مهاجم نمی‌سازد
  if (!u || !(await verifyPassword(p.currentPassword, u.password_hash)))
    return { ok: false, reason: "wrong_current" };

  if (await verifyPassword(p.newPassword, u.password_hash))
    return { ok: false, reason: "same_as_current" };

  const hash = await hashPassword(p.newPassword);
  await sql.begin(async (tx) => {
    await tx`UPDATE app_user SET password_hash = ${hash} WHERE id = ${p.userId}`;
    await invalidateSessionsIn(tx, p.userId);
    // کدهای بازیابیِ در جریان هم باید بمیرند: کسی که رمز را عوض کرده،
    // کدِ SMSیِ نیم‌ساعت پیش نباید هنوز بتواند رمز را دوباره عوض کند.
    await tx`UPDATE password_reset SET used_at = now()
             WHERE user_id = ${p.userId} AND used_at IS NULL`;
  });
  return { ok: true };
}

/**
 * درخواستِ کدِ بازیابی. **همیشه** «انجام شد» برمی‌گرداند.
 * اگر کاربر وجود داشته باشد کد ساخته و در Outbox صف می‌شود؛ اگر نه، هیچ.
 * خروجی `code` فقط در تست/dev استفاده می‌شود و هرگز به کلاینت نمی‌رود.
 *
 * v3: `identifier` می‌تواند موبایل یا ایمیل باشد — کاربر با هرکدام که یادش
 * بماند/دم‌دست‌تر باشد بازیابی را شروع می‌کند. کد به **همه‌ی** کانال‌های موجودِ
 * همان کاربر صف می‌شود (نه فقط همان کانالی که با آن جست‌وجو شد)، چون کلِ هدف
 * این است که قطعیِ یک کانال بازیابی را متوقف نکند.
 */
export async function requestReset(identifier: string): Promise<{ code: string | null }> {
  // app_user ستون tenant_id ندارد، پس RLS رویش نیست و این کوئری امن است.
  const [u] = await sql<{ id: string; phone: string; email: string | null }[]>`
    SELECT id, phone, email FROM app_user WHERE (phone = ${identifier} OR email = ${identifier}) AND is_active`;
  if (!u) { await dummyResetWork(); return { code: null }; }

  /*
   * بازیابیِ رمز کارِ **کاربر** است نه یک tenant، پس هیچ app.tenant_id در کار نیست.
   * ولی `notification_outbox` و `tenant_membership` هر دو ستون tenant_id دارند،
   * یعنی RLS رویشان فعال است. قبلاً این INSERT مستقیم اجرا می‌شد و زیر نقشِ واقعیِ
   * اپ **صفر ردیف** درج می‌کرد — بدون خطا، فقط سکوت. یعنی نماینده برای همیشه
   * منتظرِ پیامکی می‌ماند که هرگز نمی‌آید. (dev با superuser است و RLS را دور
   * می‌زند، پس فقط در production ظاهر می‌شد — همان تله‌ی workerِ پیامک.)
   *
   * راه‌حل: tenant را با `user_contexts` (SECURITY DEFINER، از قبل موجود) پیدا کن،
   * بعد هر نوشتنی داخلِ `withTenant` انجام شود تا سیاستِ RLS برقرار باشد.
   */
  const [ctx] = await sql<{ tenant_id: string }[]>`
    SELECT tenant_id FROM user_contexts(${u.id}) LIMIT 1`;
  // کاربرِ بدونِ عضویتِ فعال: کدی نمی‌سازیم چون جایی برای فرستادنش نیست
  if (!ctx) { await dummyResetWork(); return { code: null }; }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  await withTenant(ctx.tenant_id, async (tx) => {
    // کدهای قبلیِ همین کاربر باطل می‌شوند: هر بار درخواست، فقط آخرین کد کار کند.
    await tx`UPDATE password_reset SET used_at = now()
             WHERE user_id = ${u.id} AND used_at IS NULL`;
    await tx`
      INSERT INTO password_reset (user_id, code_hash, expires_at)
      VALUES (${u.id}, ${hashCode(code)}, now() + make_interval(mins => ${CODE_TTL_MIN}))`;
    // Outbox: در همان تراکنش، تا اگر چیزی رول‌بک شد پیامِ کدِ ناموجود فرستاده نشود.
    // یک ردیف به‌ازای هر کانالِ موجود — همان کد، چند مسیر.
    await tx`
      INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
      VALUES (${ctx.tenant_id}, 'sms', ${u.phone},
              jsonb_build_object('type', 'password_reset', 'code', ${code}::text,
                                 'ttlMinutes', ${CODE_TTL_MIN}::int))`;
    if (u.email)
      await tx`
        INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
        VALUES (${ctx.tenant_id}, 'email', ${u.email},
                jsonb_build_object('type', 'password_reset', 'code', ${code}::text,
                                   'ttlMinutes', ${CODE_TTL_MIN}::int))`;
  });

  return { code };
}

/** تأیید کد و ثبتِ رمز جدید. `identifier` همان موبایل/ایمیلی است که در requestReset داده شد. */
export async function confirmReset(p: {
  identifier: string; code: string; newPassword: string;
}): Promise<Result> {
  const bad = validateNew(p.newPassword);
  if (bad) return { ok: false, reason: bad };

  const [u] = await sql<{ id: string }[]>`
    SELECT id FROM app_user WHERE (phone = ${p.identifier} OR email = ${p.identifier}) AND is_active`;
  // شناسه‌ی ناموجود همان پاسخِ «کد نامعتبر» را می‌گیرد (قاعده‌ی ۲)
  if (!u) { await dummyConfirmWork(); return { ok: false, reason: "invalid_code" }; }

  const hash = await hashPassword(p.newPassword);

  return sql.begin(async (tx) => {
    // آخرین کدِ زنده. FOR UPDATE تا دو تلاشِ هم‌زمان شمارنده را خراب نکنند.
    const [row] = await tx<{ id: string; code_hash: string; attempt_count: number }[]>`
      SELECT id, code_hash, attempt_count FROM password_reset
      WHERE user_id = ${u.id} AND used_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`;
    if (!row) return { ok: false, reason: "invalid_code" as const };

    if (row.attempt_count >= MAX_CODE_ATTEMPTS) {
      // سوزاندنِ کد بعد از تلاشِ زیاد: وگرنه کدِ شش‌رقمی با ۱۰ دقیقه وقت
      // قابلِ جست‌وجوی کامل است.
      await tx`UPDATE password_reset SET used_at = now() WHERE id = ${row.id}`;
      return { ok: false, reason: "too_many_attempts" as const };
    }

    if (hashCode(p.code) !== row.code_hash) {
      await tx`UPDATE password_reset SET attempt_count = attempt_count + 1 WHERE id = ${row.id}`;
      return { ok: false, reason: "invalid_code" as const };
    }

    await tx`UPDATE password_reset SET used_at = now() WHERE id = ${row.id}`;
    await tx`UPDATE app_user SET password_hash = ${hash} WHERE id = ${u.id}`;
    await invalidateSessionsIn(tx, u.id);
    return { ok: true as const };
  });
}
