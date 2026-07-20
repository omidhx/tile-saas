import postgres from "postgres";

// یک اتصال مشترک. postgres.js خودش pool مدیریت می‌کنه.
// نکته‌ی امنیتی: اپ باید با نقشِ NON-superuser وصل شه وگرنه RLS بایپس می‌شه (schema.sql).
const sql = postgres(process.env.DATABASE_URL!, {
  max: 10,
  // NOTICEهای پرحرفِ postgres (مثلاً «drop cascades to ۳۵ object») خروجی seed و تست را
  // غیرقابل‌خواندن می‌کنند و در production فقط لاگ را پر می‌کنند. با DEBUG_PG_NOTICE برمی‌گردند.
  onnotice: process.env.DEBUG_PG_NOTICE ? console.log : () => {},
});

export { sql };

/**
 * هر کار روی داده‌ی یک تننت باید داخل withTenant اجرا شه.
 * SET LOCAL app.tenant_id → سیاست RLS فعال می‌شه (schema.sql بخش ۸).
 * این لایه‌ی دوم دفاعیه، کنارِ composite FK — نه به‌جاش.
 *
 * ponytail: قفل ORDER BY lot_id و چک available در reserve() است، نه اینجا.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  // cast: sql.begin تایپش آرایه را unwrap می‌کنه (UnwrapPromiseArray)، با T جنریک نمی‌خونه
  const result = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
  return result as T;
}
