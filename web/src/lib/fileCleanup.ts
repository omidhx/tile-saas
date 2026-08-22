import { unlink } from "node:fs/promises";
import { join, normalize, resolve } from "node:path";
import * as Sentry from "@sentry/nextjs";

/**
 * حذفِ امنِ فایلِ آپلودشده از دیسک.
 *
 * چرا این تابع وجود دارد: `product_image` فقط رکورد DB را حذف می‌کرد و فایلِ فیزیکی
 * روی دیسک می‌ماند. این یعنی با گذشتِ زمان، `public/uploads/` با فایل‌های یتیم پر
 * می‌شد — هیچ‌کس به آن‌ها اشاره نمی‌کرد ولی حجم و تعداد فایل‌ها فقط بالا می‌رفت.
 *
 * امنیتِ مسیر (path traversal):
 *
 *   فقط مسیرهای `/uploads/...` (خروجیِ /api/upload) را حذف می‌کند. هرگز URL خارجی
 *   (http/https) را پاک نمی‌کند — آن فایل‌ها مالِ ما نیستند.
 *
 *   ولی این کافی نیست: اگر کسی در DB مسیر `/uploads/../../.env` گذاشته باشد (با
 *   دسترسیِ مستقیم به DB یا با exploit)، نباید آن را حذف کنیم. پس:
 *
 *   ۱. فقط مسیرهای `/uploads/...` را قبول کن.
 *   ۲. بعد از normalize، باید داخلِ `public/uploads/` باشد — نه parent.
 *   ۳. اگر نبود، رد کن و خطا را با Sentry لاگ کن.
 *
 * بی‌صدا اگر فایل وجود نداشت: می‌خواهیم remove از DB اتمیک بماند — اگر فایل فیزیکی
 * از قبل حذف شده بود (مثلاً دستی)، رکورد DB نباید سرجایش بماند.
 *
 * بی‌صدا نباشد اگر unlink خطای واقعی داد (permission، I/O): باید لاگِ پرصدا با
 * Sentry بزند. catch خالی یعنی regression فردا بدون تشخیص می‌ماند.
 */
export async function deleteUploadFile(url: string): Promise<void> {
  const trimmed = url.trim();

  // فقط مسیرهای نسبی خودِ سایت (خروجیِ /api/upload) — نه URL خارجی
  if (!trimmed.startsWith("/uploads/")) return;

  // /uploads/foo.jpg → public/uploads/foo.jpg
  const relPath = trimmed.slice(1); // حذفِ اسلشِ اول
  const uploadsRoot = resolve(process.cwd(), "public", "uploads");
  const absPath = normalize(resolve(process.cwd(), "public", relPath));

  // بررسیِ path traversal: absPath باید داخلِ uploadsRoot باشد
  // (با separator انتهای، جلوی `/uploads2/...` را هم می‌گیرد)
  if (!absPath.startsWith(uploadsRoot + "/") && absPath !== uploadsRoot) {
    // این یعنی有人在 DB مسیرِ مخرب گذاشته — لاگِ پرصدا
    Sentry.captureMessage(
      `deleteUploadFile: path traversal attempt rejected — url="${url}", resolved="${absPath}"`,
      { level: "error", tags: { component: "file-cleanup", security: "path-traversal" } },
    );
    return;
  }

  try {
    await unlink(absPath);
  } catch (err: unknown) {
    // ENOENT یعنی فایل از قبل وجود نداشت — بی‌خطر، رد شو
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    // خطاهای دیگر (permission، I/O، etc.) — لاگِ پرصدا، ولی رکورد DB را برگردان نده
    Sentry.captureException(err, {
      level: "error",
      tags: { component: "file-cleanup" },
      extra: { url, absPath },
    });
    console.error(`[deleteUploadFile] حذفِ فایل ناموفق (${absPath}):`, err);
  }
}

/**
 * حذفِ همه‌ی فایل‌های آپلودشده از یک لیست URL.
 * برای زمانی که چند عکس با هم حذف می‌شوند (مثلاً حذفِ محصول).
 */
export async function deleteUploadFiles(urls: string[]): Promise<void> {
  await Promise.all(urls.map((u) => deleteUploadFile(u)));
}
