/**
 * `File.type` را مرورگر از فرم پر می‌کند — یعنی یک اسکریپتِ کلاینتی می‌تواند
 * `Blob`ی با هر `type` دلخواه بسازد، صرفِ‌نظر از بایت‌های واقعی. این تابع اولین
 * بایت‌ها را با امضای واقعیِ فرمت تطبیق می‌دهد (defense-in-depth کنارِ
 * `X-Content-Type-Options: nosniff` که همین الان هست).
 */
export function matchesMagicBytes(mime: string, buf: Buffer): boolean {
  if (mime === "image/jpeg") return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (mime === "image/png")
    return buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === "image/webp")
    return buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}
