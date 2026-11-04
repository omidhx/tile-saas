import { sql } from "./client";

/**
 * شناسه‌های ثابتی که تقریباً هر فایلِ db/*.test.ts جداگانه به‌عنوانِ
 * `const T = "11111111-…"` تکرار می‌کرد. بقیه‌ی شناسه‌ها (agent/warehouse/
 * variant/lot) عمداً این‌جا نیستند — هم مقدار هم نامِ محلی‌شان بینِ فایل‌ها
 * فرق می‌کند (یکی `V` صدا می‌زند دیگری `VAR`، یکی یک انبار دارد دیگری دو‌تا)،
 * پس یکی‌کردنشان یعنی یا فیکسچر باید انبوهِ گزینه بگیرد یا فایل‌ها را به
 * شکلِ یکی‌شان مجبور کند. فقط چیزی که واقعاً همه‌جا عینِ هم بود این‌جاست.
 */
export const T = "11111111-1111-1111-1111-111111111111";
export const U = "a8888888-8888-8888-8888-888888888888";

/** ردیفِ تنانت — پیشوندِ مشترکِ تقریباً همه‌ی فایل‌های تست. */
export async function seedTenant() {
  await sql.unsafe(`INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');`);
}

/** تنانت + یک app_user پایه — برای فایل‌هایی که یک actor/کاربر هم لازم دارند. */
export async function seedTenantUser() {
  await sql.unsafe(`
    INSERT INTO tenant (id,name,slug) VALUES ('${T}','A','a');
    INSERT INTO app_user (id,phone,password_hash) VALUES ('${U}','0910','x');
  `);
}
