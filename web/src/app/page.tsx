import { redirect } from "next/navigation";
import { currentUserId } from "@/auth/session";
import { sql } from "@/db/client";

/**
 * قبلاً همه بی‌قیدوشرط به /reserve می‌رفتند — پشتیبانی که مستقیم «/» را باز
 * می‌کرد (بوکمارک، تبِ جدید) روی صفحه‌ی نماینده می‌نشست و بنرِ «به نمایندگی‌ای
 * وصل نیستی» می‌گرفت. صفحه‌ی لاگین این را برای مسیرِ ورود درست کرده بود؛ اینجا
 * هم باید همان منطق باشد. user_contexts خودِ /api/me هم همین را می‌خواند.
 */
export default async function Home() {
  const userId = await currentUserId();
  if (!userId) redirect("/login");

  const rows = await sql<{ role: string }[]>`SELECT role FROM user_contexts(${userId})`;
  const isStaff = rows.some((r) => r.role === "staff" || r.role === "admin");
  redirect(isStaff ? "/staff" : "/reserve");
}
