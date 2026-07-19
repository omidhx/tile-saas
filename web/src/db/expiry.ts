import { sql } from "./client";

/**
 * بوک‌کیپینگِ انقضا: رزروهای از مهلت گذشته را active→expired می‌کند.
 * cross-tenant است (نگهداری)، پس withTenant ندارد — تابعِ SECURITY DEFINER از RLS عبور می‌کند.
 *
 * مهم: درستیِ available به این وابسته **نیست**. held همیشه شرطِ `expires_at > now()` را
 * دارد، پس رزروِ منقضی حتی قبل از اجرای این هم موجودی را آزاد کرده. این فقط لیست‌ها/گزارش‌ها
 * را مرتب می‌کند؛ اگر یک اجرا جا بیفتد هیچ عددی غلط نمی‌شود.
 */
export async function expireDueReservations(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`SELECT expire_due_reservations() AS n`;
  return Number(row.n);
}
