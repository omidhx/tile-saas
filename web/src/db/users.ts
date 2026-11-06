import type postgres from "postgres";
import { hashPassword, generateTempPassword } from "@/auth/password";

export type FindOrCreateResult =
  | { ok: true; userId: string; created: boolean; tempPassword: string | null }
  | { ok: false; reason: "email_taken" };

/**
 * کاربرِ موجود با این موبایل را برمی‌گرداند، وگرنه با رمزِ یک‌بارمصرف می‌سازد.
 * app_user سراسری است (نه tenant-scoped) — کاربرِ یک tenant دیگر همان رکورد را
 * می‌گیرد، نه رکوردِ دوم با همان موبایل. مشترکِ بینِ دعوتِ تیم (db/team.ts) و
 * ساختِ نمایندگی (db/agents.ts).
 *
 * کاربرِ موجود **کاملاً** دست‌نخورده می‌ماند: نه رمز، نه ایمیل، نه نام. app_user سراسری است،
 * پس مدیرِ یک tenant با نوشتنِ ایمیل روی حسابی که ایمیل نداشت، کدِ بازیابیِ رمزِ آن حساب
 * (شاید مدیرِ کارخانه‌ی دیگر) را به ایمیلِ خودش می‌فرستاد: تصاحبِ حساب بینِ tenantها
 * (ممیزی، blocker ۱). پس ایمیل و نام فقط برای کاربرِ تازه از ورودیِ دعوت می‌آید.
 */
export async function findOrCreateUser(
  tx: postgres.TransactionSql, phone: string, email: string | null, fullName?: string | null,
): Promise<FindOrCreateResult> {
  const [existing] = await tx<{ id: string }[]>`
    SELECT id FROM app_user WHERE phone = ${phone}`;

  if (existing) return { ok: true, userId: existing.id, created: false, tempPassword: null };

  if (email) {
    const [dup] = await tx<{ id: string }[]>`SELECT id FROM app_user WHERE email = ${email}`;
    if (dup) return { ok: false, reason: "email_taken" };
  }
  const tempPassword = generateTempPassword();
  const [u] = await tx<{ id: string }[]>`
    INSERT INTO app_user (phone, email, full_name, password_hash)
    VALUES (${phone}, ${email}, ${fullName ?? null}, ${await hashPassword(tempPassword)})
    RETURNING id`;
  return { ok: true, userId: u.id, created: true, tempPassword };
}
