import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

// bcrypt، نه الگوریتم دست‌ساز (spec بخش ۸). cost 12 تعادل امنیت/سرعت برای این مقیاس.
export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

// v3: رمزِ اولیه‌ی حساب‌های دعوت‌شده (تیم/نمایندگی). حروفِ شبیه‌به‌هم (0/O، 1/l/I)
// عمداً حذف شده‌اند — این رمز قرار است تلفنی/پیامکی خوانده شود، نه تایپ از کیبورد.
const CHARS = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function generateTempPassword(length = 10): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CHARS[randomInt(CHARS.length)];
  return out;
}
