// =============================================================================
// scripts/cleanup-orphan-uploads.ts — حذفِ فایل‌های یتیم از public/uploads/
// =============================================================================
// دو نوع یتیم را پاک می‌کند:
//
//   ۱. فایل روی دیسک که URL آن در DB reference ندارد — یعنی upload موفق بوده
//      ولی INSERT به DB شکست خورده (یا رکورد بعداً حذف شده ولی فایل فیزیکی مانده).
//      این حالت قبل از افزودنِ deleteUploadFile به removeProductImage رایج بود.
//
//   ۲. (در آینده) URL در DB که فایل فیزیکی ندارد — برای diagnose، نه cleanup.
//      این حالت یتیم نیست، فقط داده‌ی ناقص است.
//
// چرا dry-run پیش‌فرض: حذفِ فایل مخرب است. اول بدونِ --commit اجرا کنید تا
// ببینید چه‌چیز حذف می‌شود؛ بعد با --commit اجرا کنید.
//
// استفاده:
//   DATABASE_URL=postgres://... node --import tsx scripts/cleanup-orphan-uploads.ts            # dry-run
//   DATABASE_URL=postgres://... node --import tsx scripts/cleanup-orphan-uploads.ts --commit   # واقعی
//
// به‌علاوه --max-days=N برای محدودکردنِ فایل‌های قدیمی‌تر از N روز (پیش‌فرض: ۷).
// فایل‌های تازه‌تر از این سقف رد می‌شوند چون ممکن است در حالِ upload باشند.
// =============================================================================

import { readdir, unlink, stat } from "node:fs/promises";
import { join, resolve, normalize } from "node:path";
import postgres from "postgres";

const UPLOADS_DIR = join(process.cwd(), "public", "uploads");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL تنظیم نشده.");
    process.exit(1);
  }
  const commit = process.argv.includes("--commit");
  const maxDaysArg = process.argv.find((a) => a.startsWith("--max-days="));
  const maxDays = maxDaysArg ? parseInt(maxDaysArg.split("=")[1], 10) : 7;
  if (!Number.isFinite(maxDays) || maxDays < 0) {
    console.error("--max-days باید عدد غیرمنفی باشد.");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    // ۱. خواندنِ همه‌ی فایل‌های روی دیسک
    let filesOnDisk: string[] = [];
    try {
      filesOnDisk = (await readdir(UPLOADS_DIR)).filter((f) => !f.startsWith("."));
    } catch {
      console.error(`پوشه‌ی uploads وجود ندارد: ${UPLOADS_DIR}`);
      process.exit(1);
    }

    if (filesOnDisk.length === 0) {
      console.log("✓ هیچ فایلی در uploads/ نیست — چیزی برای پاک‌کردن نیست.");
      return;
    }

    // ۲. خواندنِ همه‌ی URLهای ذخیره‌شده در دیتابیس
    const productImgUrls = await sql<{ url: string }[]>`
      SELECT DISTINCT url FROM product_image WHERE url LIKE '/uploads/%'`;
    const productPrimaryUrls = await sql<{ url: string }[]>`
      SELECT DISTINCT image_url AS url FROM product WHERE image_url LIKE '/uploads/%'`;
    const tenantLogoUrls = await sql<{ url: string }[]>`
      SELECT DISTINCT logo_url AS url FROM tenant WHERE logo_url LIKE '/uploads/%'`;

    const referenced = new Set<string>();
    for (const { url } of productImgUrls) referenced.add(url);
    for (const { url } of productPrimaryUrls) referenced.add(url);
    for (const { url } of tenantLogoUrls) referenced.add(url);

    // ۳. تشخیصِ فایل‌های یتیم — فایل روی دیسک که در DB reference ندارد
    const uploadsRoot = resolve(UPLOADS_DIR);
    const now = Date.now();
    const maxAgeMs = maxDays * 24 * 60 * 60 * 1000;
    const orphans: { file: string; size: number; mtime: Date }[] = [];

    for (const f of filesOnDisk) {
      const absPath = normalize(join(UPLOADS_DIR, f));

      // path traversal safety — نمی‌خواهیم چیزی خارج از uploadsRoot را ببینیم
      if (!absPath.startsWith(uploadsRoot + "/") && absPath !== uploadsRoot) {
        continue;
      }

      const relUrl = `/uploads/${f}`;
      if (referenced.has(relUrl)) continue;

      // فایل‌های تازه‌تر از maxDays را رد کن — ممکن است در حالِ upload باشند
      // یا test داده‌ی جدید باشد که هنوز commit نشده.
      try {
        const s = await stat(absPath);
        const age = now - s.mtimeMs;
        if (age < maxAgeMs) {
          continue;
        }
        orphans.push({ file: f, size: s.size, mtime: s.mtime });
      } catch {
        // stat شکست خورد — فایل احتمالاً پاک شده. رد کن.
        continue;
      }
    }

    if (orphans.length === 0) {
      console.log("✓ هیچ فایلِ یتیمی نیست — همه‌ی فایل‌ها در دیتابیس reference دارند.");
      console.log(`  (بررسی شد: ${filesOnDisk.length} فایل، ${referenced.size} reference در DB)`);
      return;
    }

    // ۴. محاسبه‌ی حجمِ کلِ یتیم‌ها
    const totalSize = orphans.reduce((sum, o) => sum + o.size, 0);

    console.log(`\n📋 ${orphans.length} فایل یتیم یافت شد (مجموع ${(totalSize / 1024 / 1024).toFixed(2)} مگابایت).`);
    console.log(`   محدوده‌ی زمانی: فایل‌های قدیمی‌تر از ${maxDays} روز`);
    console.log(`   حالت: ${commit ? "🔴 حذف واقعی" : "🟡 dry-run (بدونِ حذف)"}`);
    console.log("\n   نمونه‌ها (۱۰ تای اول):");
    for (const o of orphans.slice(0, 10)) {
      const ageDays = Math.floor((now - o.mtime.getTime()) / (24 * 60 * 60 * 1000));
      console.log(`   - ${o.file}  (${(o.size / 1024).toFixed(1)}KB, ${ageDays} روز پیش)`);
    }
    if (orphans.length > 10) console.log(`   ... و ${orphans.length - 10} مورد دیگر`);

    if (!commit) {
      console.log("\nبرای حذف واقعی، با فلگِ --commit اجرا کنید:");
      console.log("  node --import tsx scripts/cleanup-orphan-uploads.ts --commit");
      console.log(`  (یا با محدوده‌ی زمانی متفاوت: --max-days=30)`);
      return;
    }

    // ۵. حذفِ واقعی
    let deleted = 0, failed = 0;
    for (const o of orphans) {
      try {
        await unlink(join(UPLOADS_DIR, o.file));
        deleted++;
      } catch (err) {
        console.error(`   ⚠ حذف ناموفق: ${o.file}`, err);
        failed++;
      }
    }
    console.log(`\n✓ ${deleted} فایل حذف شد.`);
    if (failed > 0) console.warn(`⚠ ${failed} فایل حذف نشد.`);
  } finally {
    await sql.end();
  }
}

main();
