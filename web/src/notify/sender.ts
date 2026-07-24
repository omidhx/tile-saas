// فرستنده‌ی چندکاناله — spec ۵.۹ + v3 «چندکاناله».
//
// چرا سه کانال: پیامک تنها راه نبود — قطعیِ خطِ SMS (که در ایران کم هم پیش نمی‌آید)
// یعنی کاربر هیچ کدِ بازیابی/دعوتی نمی‌گیرد. email و بله همان کد را از مسیرِ دیگر
// می‌برند؛ کاربر با هرکدام که کار می‌کند وارد می‌شود.
//
// ponytail: هیچ ارائه‌دهنده‌ای اینجا hardcode نشده چون اعتبارنامه/مستنداتش را نداریم.
// پیش‌فرضِ هر سه `log` است: پیام را چاپ می‌کند و موفق برمی‌گرداند، تا کلِ زنجیره (صف →
// worker → sent) بدون قرارداد با هیچ ارائه‌دهنده‌ای قابل اجرا و تست باشد.
// برای پروداکشن: فقط همان یک تابعِ provider عوض می‌شود، بقیه‌ی سیستم دست نمی‌خورد.
//   SMS_PROVIDER=kavenegar (یا هر پنل ایرانی)
//   EMAIL_PROVIDER=smtp (یا sendgrid/...)
//   BALE_PROVIDER=bot   — نیازمندِ webhook عمومی برای اتصالِ حساب (فلوی جدا، هنوز نیست)

export type SendResult = { ok: true } | { ok: false; error: string };
export type Channel = "sms" | "email" | "bale";
export type Notification = { to: string; text: string; subject?: string };

async function logSender(channel: Channel, n: Notification): Promise<SendResult> {
  console.log(`[${channel}:log] → ${n.to}${n.subject ? ` (${n.subject})` : ""}: ${n.text}`);
  return { ok: true };
}

export async function sendSms(sms: Notification): Promise<SendResult> {
  const provider = process.env.SMS_PROVIDER ?? "log";
  switch (provider) {
    case "log": return logSender("sms", sms);
    default: return { ok: false, error: `SMS_PROVIDER ناشناخته: ${provider}` }; // fail-loud نه fail-silent
  }
}

export async function sendEmail(email: Notification): Promise<SendResult> {
  const provider = process.env.EMAIL_PROVIDER ?? "log";
  switch (provider) {
    case "log": return logSender("email", email);
    default: return { ok: false, error: `EMAIL_PROVIDER ناشناخته: ${provider}` };
  }
}

export async function sendBale(bale: Notification): Promise<SendResult> {
  const provider = process.env.BALE_PROVIDER ?? "log";
  switch (provider) {
    case "log": return logSender("bale", bale);
    default: return { ok: false, error: `BALE_PROVIDER ناشناخته: ${provider}` };
  }
}

export function send(channel: Channel, n: Notification): Promise<SendResult> {
  if (channel === "email") return sendEmail(n);
  if (channel === "bale") return sendBale(n);
  return sendSms(n);
}

/** متنِ پیام از payload. جدا نگه داشته شده تا قالب‌ها یک‌جا باشند. */
export function renderMessage(payload: Record<string, unknown>): string {
  if (payload.type === "restock")
    return `موجود شد: ${payload.product} (${payload.code}). برای رزرو وارد پنل شوید.`;
  if (payload.type === "waitlist_offer")
    return `نوبت شما رسید: ${payload.qty} کارتن ${payload.product} (${payload.code}) برای شما رزرو شد `
      + `و تا ${payload.ttlHours} ساعت نگه داشته می‌شود. برای نهایی‌کردن وارد پنل شوید.`;
  if (payload.type === "password_reset")
    // بدونِ نامِ کاربر یا هر چیزِ دیگر: پیامکِ حاوی کد ممکن است روی قفلِ صفحه دیده شود
    return `کد بازیابی رمز: ${payload.code}\nتا ${payload.ttlMinutes} دقیقه معتبر است. `
      + `اگر شما درخواست نداده‌اید، این پیام را نادیده بگیرید.`;
  if (payload.type === "team_invite")
    return `به تیمِ ${payload.tenantName} اضافه شدید. ورود: ${payload.identifier} / رمزِ یک‌بارمصرف: ${payload.tempPassword}\n`
      + `پس از ورود، رمز را عوض کنید.`;
  if (payload.type === "agent_invite")
    return `دسترسیِ نمایندگیِ «${payload.agentName}» برایتان ساخته شد (${payload.tenantName}). `
      + `ورود: ${payload.identifier} / رمزِ یک‌بارمصرف: ${payload.tempPassword}\nپس از ورود، رمز را عوض کنید.`;
  return String(payload.text ?? "اعلان جدید");
}

/** عنوانِ ایمیل — فقط ایمیل subject جدا دارد؛ پیامک/بله همان متن را بدونِ عنوان می‌گیرند. */
export function renderSubject(payload: Record<string, unknown>): string {
  if (payload.type === "password_reset") return "کدِ بازیابیِ رمزِ عبور";
  if (payload.type === "team_invite" || payload.type === "agent_invite") return "دعوت به سامانه";
  if (payload.type === "restock" || payload.type === "waitlist_offer") return "اعلانِ موجودی";
  return "اعلانِ جدید";
}
