// فرستنده‌ی پیامک — spec ۵.۹ (پیامک، نه تلگرام) و ۱۴.۱۰ (ارائه‌دهنده‌ی ایرانی).
//
// ponytail: هیچ ارائه‌دهنده‌ای اینجا hardcode نشده چون اعتبارنامه/مستنداتش را نداریم.
// پیش‌فرض `log` است: پیام را چاپ می‌کند و موفق برمی‌گرداند، تا کلِ زنجیره (صف →
// worker → sent) بدون قرارداد با پنل پیامک قابل اجرا و تست باشد.
// برای پروداکشن: SMS_PROVIDER=kavenegar (یا هر پنل ایرانی) را پیاده کن — فقط همین
// یک تابع عوض می‌شود، بقیه‌ی سیستم دست نمی‌خورد.

export type SmsResult = { ok: true } | { ok: false; error: string };

export type Sms = { to: string; text: string };

async function logSender(sms: Sms): Promise<SmsResult> {
  console.log(`[sms:log] → ${sms.to}: ${sms.text}`);
  return { ok: true };
}

export async function sendSms(sms: Sms): Promise<SmsResult> {
  const provider = process.env.SMS_PROVIDER ?? "log";
  switch (provider) {
    case "log":
      return logSender(sms);
    default:
      // fail-loud نه fail-silent: پیام «ارسال‌شده» علامت نخورد در حالی که نرفته
      return { ok: false, error: `SMS_PROVIDER ناشناخته: ${provider}` };
  }
}

/** متنِ پیام از payload. جدا نگه داشته شده تا قالب‌ها یک‌جا باشند. */
export function renderMessage(payload: Record<string, unknown>): string {
  if (payload.type === "restock")
    return `موجود شد: ${payload.product} (${payload.code}). برای رزرو وارد پنل شوید.`;
  return String(payload.text ?? "اعلان جدید");
}
