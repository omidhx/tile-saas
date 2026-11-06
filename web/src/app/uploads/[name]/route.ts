import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * GET /uploads/<uuid>.<ext> — عکسِ آپلودشده، با همان URLی که در DB ذخیره می‌شود.
 *
 * عمومی است، چون عکسِ کاشی و لوگو محتوای کاتالوگ‌اند و کاتالوگِ اشتراکی ورود ندارد. route
 * قبلی (`/api/uploads/[id]`) ورود می‌خواست، بیرون از withTenant زیرِ RLS هیچ ردیفی نمی‌دید،
 * و URLِ ذخیره‌شده (`/uploads/x`) اصلاً به آن نمی‌رسید؛ پس هیچ عکسی نمایش داده نمی‌شد (فاز ۴).
 * نام از randomUUID است و حدس زده نمی‌شود. فقط همان الگو به دیسک می‌رسد، پس path traversal ندارد.
 */
const NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const TYPE: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const m = NAME.exec(name);
  if (!m) return new Response("not found", { status: 404 });
  const file = await readFile(join(process.cwd(), "private", "uploads", name)).catch(() => null);
  if (!file) return new Response("not found", { status: 404 });
  return new Response(file, {
    headers: {
      "Content-Type": TYPE[m[1]],
      // نامِ فایل هرگز عوض نمی‌شود؛ عکسِ تازه نامِ تازه می‌گیرد
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
