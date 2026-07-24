import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { currentUserId } from "@/auth/session";
import { authorizeStaffPage, AuthzError } from "@/auth/authz";

/**
 * آپلودِ عکسِ محصول (v2 کاتالوگ تصویری). staff-only.
 *
 * ذخیره روی دیسکِ محلی (`public/uploads/`) — برای این مقیاس (چند صد کاشی) S3
 * over-engineering است. **این پوشه باید در production روی volumeی جدا از کدِ
 * دیپلوی‌شونده باشد** وگرنه دیپلویِ بعدی عکس‌ها را پاک می‌کند (GO_LIVE).
 *
 * فایل با UUID نام‌گذاری می‌شود، نه با نامِ کاربر: هم برخوردِ نام حل می‌شود، هم
 * نامِ فایلِ مخرب (path traversal با «../») بی‌اثر می‌شود چون اصلاً استفاده نمی‌شود.
 */

const MAX_BYTES = 3 * 1024 * 1024; // ۳ مگابایت — عکسِ کاشی از این بزرگ‌تر بی‌دلیل است
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const tenantId = form?.get("tenantId");
  const file = form?.get("file");
  if (typeof tenantId !== "string" || !(file instanceof File))
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  try {
    await authorizeStaffPage(userId, tenantId, "catalog");
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  // نوعِ فایل از خودِ محتوا (File.type)، نه از پسوندِ نام: کاربر نباید بتواند
  // یک اسکریپت را با نامِ .jpg آپلود کند.
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: "bad_type" }, { status: 415 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });

  const dir = join(process.cwd(), "public", "uploads");
  await mkdir(dir, { recursive: true });
  const name = `${randomUUID()}.${ext}`;
  await writeFile(join(dir, name), Buffer.from(await file.arrayBuffer()));

  // URLِ عمومی — همان چیزی که import هم می‌دهد، پس لایه‌ی نمایش فرقی نمی‌بیند.
  return NextResponse.json({ url: `/uploads/${name}` }, { status: 201 });
}
