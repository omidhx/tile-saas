import bcrypt from "bcryptjs";

// bcrypt، نه الگوریتم دست‌ساز (spec بخش ۸). cost 12 تعادل امنیت/سرعت برای این مقیاس.
export const hashPassword = (plain: string) => bcrypt.hash(plain, 12);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
