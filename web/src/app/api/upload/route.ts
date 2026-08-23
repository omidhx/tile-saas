import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join, resolve, normalize } from "node:path";
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
 *
 * ذخیره روی دیسکِ محلی (`public/uploads/`) — برای این مقیاس (چند صد کاشی)
 * S3 over-engineering است. **این پوشه باید در production روی volumeی جدا از
 * کدِ دیپلوی‌شونده باشد** (نگاه کن به GO_LIVE.md).
 */

const MAX_BYTES = 3 * 1024 * 1024; // ۳ مگابایت — عکسِ کاشی از این بزرگ‌تر بی‌دلیل است
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  // ۱. احراز هویت
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

  // ۶. اعتبارسنجی محتوای واقعی (magic bytes)
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!matchesMagicBytes(file.type, bytes))
    return NextResponse.json({ error: "bad_type" }, { status: 415 });

  // ۷. نام‌گذاری با UUID و ذخیره
  const dir = join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;

  // path traversal safety — name فقط UUID.ext است، ولی برای defense-in-depth
  const absPath = normalize(resolve(dir, name));
  const uploadsRoot = resolve(process.cwd(), "public", "uploads");
  if (!absPath.startsWith(uploadsRoot + "/") && absPath !== uploadsRoot) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  await writeFile(absPath, bytes);

  // URLِ عمومی — همان چیزی که product-images و settings/tenant استفاده می‌کنند
  return NextResponse.json({ url: `/uploads/${name}` }, { status: 201 });
}
