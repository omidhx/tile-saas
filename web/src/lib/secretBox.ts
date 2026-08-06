import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * رمزنگاریِ رازهای provider-level (کلید/رمزِ عبورِ پنلِ پیامکی) قبل از نشستن در DB.
 *
 * کلیدِ جدا لازم نیست — از همان AUTH_SECRET (session.ts) مشتق می‌شود: یک رازِ
 * سرتاسری که از قبل هست و همان قیدِ «۳۲+ کاراکتر» را دارد؛ افزودنِ رازِ دوم فقط
 * یک متغیرِ محیطیِ دیگر برای گم‌کردن بود بدونِ سودِ امنیتیِ واقعی.
 */
function key() {
  const raw = process.env.AUTH_SECRET;
  if (!raw || raw.length < 32)
    throw new Error("AUTH_SECRET تنظیم نشده یا کوتاه‌تر از ۳۲ کاراکتر است — بدونش رازهای پیامکی رمزنگاری نمی‌شوند");
  return createHash("sha256").update(raw).digest();
}

/** AES-256-GCM. خروجی: `iv:tag:ciphertext` (هر سه base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(":");
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, encB64] = stored.split(":");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  d.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([d.update(Buffer.from(encB64, "base64")), d.final()]).toString("utf8");
}

/** برای نمایشِ ماسک‌شده در UI — کاربر با «•••1234» می‌فهمد رازی ست شده بدونِ دیدنِ خودش. */
export function maskSecret(plain: string): string {
  return `••••${plain.slice(-4)}`;
}
