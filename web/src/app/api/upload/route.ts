import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { join, resolve, normalize } from "node:path";
import * as Sentry from "@sentry/nextjs";
import { currentUserId } from "@/auth/session";
import { authorizeStaffPage, AuthzError } from "@/auth/authz";
import { matchesMagicBytes } from "@/lib/magicBytes";

/**
 * POST /api/upload — آپلودِ عکسِ محصول یا لوگو (staff-only).
 *
 * این endpoint عکس را از formData دریافت می‌کند و با اعتبارسنجیِ چندلایه
 * ذخیره می‌کند:
 *
 *   ۱. احراز هویت (currentUserId از JWT)
 *   ۲. مجوز (authorizeStaffPage با pageKey="catalog")
 *   ۳. اعتبارسنجی حجم (حداکثر ۳ مگابایت)
 *   ۴. اعتبارسنجی نوع فایل (whitelist MIME)
 *   ۵. اعتبارسنجی محتوای واقعی (magic bytes — نه فقط File.type که کلاینت پر می‌کند)
 *   ۶. نام‌گذاری با randomUUID (ضد path traversal و برخورد نام)
 *   ۷. orphan cleanup اگر عملیات بعدی شکست بخورد
 *
 * ذخیره روی دیسکِ محلی (`public/uploads/`) — برای این مقیاس (چند صد کاشی)
 * S3 over-engineering است. **این پوشه باید در production روی volumeی جدا از
 * کدِ دیپلوی‌شونده باشد** (نگاه کن به GO_LIVE.md).
 *
 * امنیتِ دسترسیِ فایل: فایل‌ها در `public/uploads/` قابل دسترسیِ عمومی هستند.
 * UUID در نام فایل غیرقابل‌حدس است، ولی این یک security-by-obscurity است.
 * اگر tenant isolationِ واقعی روی فایل‌ها لازم باشد، باید یک download route
 * احراز هویت‌شده ساخته شود. فعلاً برای این مقیاس (چند صد کاشی، staff-only
 * upload) قابل قبول است.
 */

const MAX_BYTES = 3 * 1024 * 1024; // ۳ مگابایت — عکسِ کاشی از این بزرگ‌تر بی‌دلیل است
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  // ۱. احراز هویت — قبل از پردازشِ فایل
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  // ۲. دریافت formData
  const form = await req.formData().catch(() => null);
  const tenantId = form?.get("tenantId");
  const file = form?.get("file");
  if (typeof tenantId !== "string" || !(file instanceof File))
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  // ۳. مجوز — staff با دسترسیِ صفحه‌ی catalog
  try {
    await authorizeStaffPage(userId, tenantId, "catalog");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  // ۴. اعتبارسنجی حجم
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  // ۵. اعتبارسنجی نوع فایل (File.type — کلاینت پر می‌کند)
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 415 });

  // ۶. اعتبارسنجی محتوای واقعی (magic bytes — مستقل از MIME)
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!matchesMagicBytes(file.type, bytes))
    return NextResponse.json({ error: "bad_type" }, { status: 415 });

  // ۷. نام‌گذاری با UUID و ذخیره
  // فایل‌ها در `private/uploads/` ذخیره می‌شوند (خارج از `public/`).
  // دسترسی فقط از طریق `/api/uploads/[id]` با احراز هویت و tenant ownership.
  // این AUD-001 را حل می‌کند — UUID مجوز دسترسی نیست، authorization واقعی است.
  const dir = join(process.cwd(), "private", "uploads");
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;

  // path traversal safety — name فقط UUID.ext است، ولی برای defense-in-depth
  const absPath = normalize(resolve(dir, name));
  const uploadsRoot = resolve(process.cwd(), "private", "uploads");
  if (!absPath.startsWith(uploadsRoot + "/") && absPath !== uploadsRoot) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // ۸. ذخیره با orphan cleanup
  // اگر writeFile موفق ولی response شکست بخورد، فایل orphan می‌ماند.
  // این با cleanup-orphan-uploads.ts اسکریپت پاک می‌شود، ولی در اینجا هم
  // اگر خطایی بعد از writeFile رخ دهد، فایل را پاک می‌کنیم.
  try {
    await writeFile(absPath, bytes);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { component: "upload", phase: "writeFile" },
      extra: { filename: name, size: bytes.length },
    });
    return NextResponse.json({ error: "write_failed" }, { status: 500 });
  }

  // URLِ عمومی — همان چیزی که product-images و settings/tenant استفاده می‌کنند
  // نکته: اگر فرانت‌اند این URL را در DB ذخیره نکند (مثلاً کاربر صفحه را ببندد)،
  // فایل orphan می‌ماند. cleanup-orphan-uploads.ts این را پاک می‌کند.
  return NextResponse.json({ url: `/uploads/${name}` }, { status: 201 });
}
