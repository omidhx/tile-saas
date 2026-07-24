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
 * کاربرِ موجود دست‌نخورده می‌ماند — رمزش عوض نمی‌شود، فقط اگر ایمیل نداشت و
 * اینجا داده شد ثبت می‌شود (یک‌طرفه: پرکردنِ جای خالی، نه بازنویسیِ چیزی که
 * کاربر خودش ست کرده).
 */
export async function findOrCreateUser(
  tx: postgres.TransactionSql, phone: string, email: string | null, fullName?: string | null,
): Promise<FindOrCreateResult> {
  const [existing] = await tx<{ id: string; email: string | null; full_name: string | null }[]>`
    SELECT id, email, full_name FROM app_user WHERE phone = ${phone}`;

  if (existing) {
    if (email && !existing.email) {
      const [dup] = await tx<{ id: string }[]>`SELECT id FROM app_user WHERE email = ${email}`;
      if (dup) return { ok: false, reason: "email_taken" };
      await tx`UPDATE app_user SET email = ${email} WHERE id = ${existing.id}`;
    }
    // مثلِ ایمیل: فقط جای خالی پر می‌شود — نامِ کاربرِ موجود را بازنویسی نمی‌کنیم.
    if (fullName && !existing.full_name)
      await tx`UPDATE app_user SET full_name = ${fullName} WHERE id = ${existing.id}`;
    return { ok: true, userId: existing.id, created: false, tempPassword: null };
  }

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
