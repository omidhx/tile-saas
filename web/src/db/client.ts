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
 * بررسیِ امنیتیِ startup — نقشِ اتصال نباید superuser یا BYPASSRLS داشته باشد.
 *
 * instrumentation.ts در startup صدایش می‌زند و با خطا پروسه را می‌بندد.
 * در dev نادیده گرفته می‌شود. تست‌ها چک خودشان را در _testdb.ts دارند.
 */
export async function assertNonSuperuserRole(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;

  const [role] = await sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT rolsuper, rolbypassrls FROM pg_roles
    WHERE rolname = current_user`;

  if (!role) {
    throw new Error(
      "assertNonSuperuserRole: نمی‌توان نقشِ فعلی را خواند. " +
      "آیا DATABASE_URL درست تنظیم شده؟",
    );
  }

  if (role.rolsuper) {
    throw new Error(
      "SECURITY: اپ با نقشِ SUPERUSER وصل شده و RLS بایپس می‌شود. DATABASE_URL باید روی app_user باشد.",
    );
  }

  if (role.rolbypassrls) {
    throw new Error(
      "SECURITY: نقشِ اتصال BYPASSRLS دارد و RLS بایپس می‌شود. DATABASE_URL باید روی app_user باشد.",
    );
  }
}

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
