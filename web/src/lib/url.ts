/**
 * آدرسِ عکس/فایل قابلِ‌قبول است اگر http(s) باشد یا مسیرِ نسبیِ خودِ سایت (مثلاً
 * خروجیِ /api/upload: `/uploads/...`). جلوِ اسکیم‌های خطرناک (`javascript:`،
 * `data:`، `//host` که مرورگر آن را protocol-relative می‌خواند) را می‌گیرد.
 * next/image با unoptimized:true اجرا می‌شود (بدونِ fetchِ سمتِ سرور)، پس اینجا
 * SSRF مطرح نیست — فقط جلوِ ذخیره‌شدنِ URLِ نامعتبر در دیتابیس گرفته می‌شود.
 */
export function isSafeImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return true;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
