import { createHash, randomInt } from "node:crypto";
import { sql } from "@/db/client";
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
 */
export async function requestReset(phone: string): Promise<{ code: string | null }> {
  const [u] = await sql<{ id: string }[]>`
    SELECT id FROM app_user WHERE phone = ${phone} AND is_active`;
  if (!u) return { code: null };

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  await sql.begin(async (tx) => {
    // کدهای قبلیِ همین کاربر باطل می‌شوند: هر بار درخواست، فقط آخرین کد کار کند.
    await tx`UPDATE password_reset SET used_at = now()
             WHERE user_id = ${u.id} AND used_at IS NULL`;
    await tx`
      INSERT INTO password_reset (user_id, code_hash, expires_at)
      VALUES (${u.id}, ${hashCode(code)}, now() + make_interval(mins => ${CODE_TTL_MIN}))`;
    // Outbox: در همان تراکنش، تا اگر چیزی رول‌بک شد پیامکِ کدِ ناموجود فرستاده نشود
    await tx`
      INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
      SELECT tm.tenant_id, 'sms', ${phone}::text,
             jsonb_build_object('type', 'password_reset', 'code', ${code}::text,
                                'ttlMinutes', ${CODE_TTL_MIN}::int)
      FROM tenant_membership tm
      WHERE tm.user_id = ${u.id} AND tm.is_active
      LIMIT 1`;
  });

  return { code };
}

/** تأیید کد و ثبتِ رمز جدید. */
export async function confirmReset(p: {
  phone: string; code: string; newPassword: string;
}): Promise<Result> {
  const bad = validateNew(p.newPassword);
  if (bad) return { ok: false, reason: bad };

  const [u] = await sql<{ id: string }[]>`
    SELECT id FROM app_user WHERE phone = ${p.phone} AND is_active`;
  // شماره‌ی ناموجود همان پاسخِ «کد نامعتبر» را می‌گیرد (قاعده‌ی ۲)
  if (!u) return { ok: false, reason: "invalid_code" };

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
