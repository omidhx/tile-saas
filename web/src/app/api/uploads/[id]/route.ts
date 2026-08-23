import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { join, resolve, normalize } from "node:path";
import { currentUserId } from "@/auth/session";
import { sql } from "@/db/client";

/**
 * GET /api/uploads/[id] — download عکس با احراز هویت و tenant ownership.
 *
 * این route جایگزین دسترسیِ مستقیمِ عمومی به `/uploads/` شده است.
 * فایل‌ها در `private/uploads/` (خارج از `public/`) ذخیره می‌شوند
 * و فقط از طریق این route با احراز هویت قابل دسترسی هستند.
 *
 * مراحل:
 *   ۱. احراز هویت (currentUserId از JWT)
 *   ۲. خواندنِ URL فایل از DB (product_image یا tenant.logo_url)
 *   ۳. استخراج tenant_id فایل از DB
 *   ۴. بررسی عضویت کاربر در tenant فایل
 *   ۵. در صورت عدم تطابق → 404 (نه 403 — نشت وجود فایل)
 *   ۶. Stream فایل با Content-Disposition امن
 *
 * نکته: پارامتر `id` در URL نام فایل است (UUID.ext)، نه ID رکورد DB.
 * ما URL را در DB پیدا می‌کنیم و tenant_id را استخراج می‌کنیم.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // ۱. احراز هویت
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  // path traversal defense — id فقط باید UUID.ext باشد
  // حذف هر کاراکتر غیر از alphanumeric، dash، و dot
  const safeId = id.replace(/[^a-zA-Z0-9.\-]/g, "");
  if (safeId !== id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ۲. جستجوی فایل در DB — product_image یا tenant.logo_url
  const fileUrl = `/uploads/${safeId}`;

  // جستجو در product_image
  const [productImage] = await sql<{ tenant_id: string }[]>`
    SELECT tenant_id FROM product_image WHERE url = ${fileUrl} LIMIT 1`;

  // اگر نبود، در tenant.logo_url جستجو کن
  let fileTenantId: string | null = null;
  if (productImage) {
    fileTenantId = productImage.tenant_id;
  } else {
    const [tenantLogo] = await sql<{ id: string }[]>`
      SELECT id FROM tenant WHERE logo_url = ${fileUrl} LIMIT 1`;
    if (tenantLogo) {
      fileTenantId = tenantLogo.id;
    }
  }

  // ۳. اگر فایل در DB پیدا نشد → 404
  if (!fileTenantId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ۴. بررسی عضویت کاربر در tenant فایل
  const [membership] = await sql<{ tenant_id: string }[]>`
    SELECT tenant_id FROM tenant_membership
    WHERE user_id = ${userId} AND tenant_id = ${fileTenantId} AND is_active
    LIMIT 1`;

  if (!membership) {
    // 404 نه 403 — نشتِ وجود فایل را لو نمی‌دهد
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ۵. خواندن فایل از disk
  // فایل‌ها در `private/uploads/` ذخیره می‌شوند (خارج از `public/`)
  const uploadsRoot = resolve(process.cwd(), "private", "uploads");
  const absPath = normalize(resolve(uploadsRoot, safeId));

  // path traversal safety
  if (!absPath.startsWith(uploadsRoot + "/") && absPath !== uploadsRoot) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // بررسی وجود فایل
  try {
    await stat(absPath);
  } catch {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // ۶. Stream فایل
  const fileBuffer = await readFile(absPath);

  // تعیین Content-Type بر اساس پسوند
  const ext = safeId.split(".").pop()?.toLowerCase();
  const contentType =
    ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
    ext === "png" ? "image/png" :
    ext === "webp" ? "image/webp" :
    "application/octet-stream";

  // Content-Disposition: inline (نمایش در مرورگر، نه download)
  // filename با UUID است — path traversal در نام فایل ممکن نیست
  return new NextResponse(fileBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${safeId}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
