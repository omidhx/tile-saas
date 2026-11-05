// ساختِ اولین مدیرِ پلتفرم، یک‌بار بعد از نصب. بقیه‌ی کارخانه‌ها و کاربرها از /platform/tenants ساخته می‌شوند.
// رمز از env می‌آید تا در تاریخچه‌ی shell و فهرستِ پروسه‌ها نماند؛ docs/GO_LIVE.md دستورش را دارد.
import bcrypt from "bcryptjs";
import postgres from "postgres";

async function main() {
  const phone = process.env.ADMIN_PHONE?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!phone || !password) throw new Error("ADMIN_PHONE و ADMIN_PASSWORD لازم‌اند.");
  if (password.length < 12) throw new Error("رمز مدیر پلتفرم باید حداقل ۱۲ کاراکتر باشد.");

  const sql = postgres((process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL)!, { max: 1, onnotice: () => {} });
  try {
    const hash = await bcrypt.hash(password, 12);
    const rows = await sql`
      INSERT INTO app_user (phone, password_hash, is_platform_admin)
      VALUES (${phone}, ${hash}, true)
      ON CONFLICT (phone) DO NOTHING
      RETURNING id`;
    if (rows.length === 0) throw new Error(`کاربری با شماره‌ی ${phone} از قبل هست؛ چیزی عوض نشد.`);
    console.log(`✓ مدیر پلتفرم ساخته شد: ${phone}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("✗", e instanceof Error ? e.message : e);
  process.exit(1);
});
