// فرستنده‌ی پیامک — spec ۵.۹.
//
// هر tenant پروایدرِ خودش را از UI کانفیگ می‌کند (`sms_config` روی tenant، رمزنگاری‌شده
// با secretBox.ts). `SMS_PROVIDER` فقط fallback است برای وقتی tenant چیزی کانفیگ نکرده.

import { getSmsConfigForSending } from "@/db/smsConfig";
import { sendViaProvider } from "./smsProviders";

export type SendResult = { ok: true } | { ok: false; error: string };
export type Channel = "sms" | "email" | "bale";
export type Notification = { to: string; text: string; subject?: string; tenantId?: string; payload?: Record<string, unknown> };

async function logSender(channel: Channel, n: Notification): Promise<SendResult> {
  // در production متنِ کامل چاپ نمی‌شود — همین پیام‌ها کدِ بازیابیِ رمز/رمزِ موقتِ
  // دعوت را خام حمل می‌کنند و اگر provider واقعی هنوز ست نشده، این تنها راهِ
  // خروجِ پیام است؛ لاگِ production معمولاً جایی جمع می‌شود که کنترلِ دسترسی ندارد.
  const body = process.env.NODE_ENV === "production" ? "[redacted]" : n.text;
  console.log(`[${channel}:log] → ${n.to}${n.subject ? ` (${n.subject})` : ""}: ${body}`);
  return { ok: true };
}

/**
 * توکن‌های موقعیتی از payload — همان ترتیبی که کاربر باید در پترنِ ساخته‌شده
 * روی پنلِ پروایدرش استفاده کند (help-textِ UI هم همین ترتیب را می‌گوید).
 */
function tokensFor(payload: Record<string, unknown>): string[] {
  const s = (v: unknown) => String(v ?? "");
  switch (payload.type) {
    case "restock": return [s(payload.product), s(payload.code)];
    case "password_reset": return [s(payload.code), s(payload.ttlMinutes)];
    case "team_invite": return [s(payload.tenantName), s(payload.identifier), s(payload.tempPassword)];
    case "agent_invite": return [s(payload.agentName), s(payload.tenantName), s(payload.identifier), s(payload.tempPassword)];
    default: return [];
  }
}

export async function sendSms(sms: Notification): Promise<SendResult> {
  const cfg = sms.tenantId ? await getSmsConfigForSending(sms.tenantId) : null;
  // خاموش یا کانفیگ‌نشده → همان لحظه برمی‌گردد، بدونِ HTTP call — «سبک و بی‌مزاحمت».
  if (!cfg || !cfg.enabled) {
    if (sms.tenantId && cfg === null) return logSender("sms", sms); // کانفیگ نشده: fallback به log برای dev/تست
    if (sms.tenantId) return { ok: true }; // صریحاً خاموش‌شده توسطِ tenant
    const provider = process.env.SMS_PROVIDER ?? "log";
    return provider === "log" ? logSender("sms", sms) : { ok: false, error: `SMS_PROVIDER ناشناخته: ${provider}` };
  }
  const type = sms.payload?.type as string | undefined;
  const pattern = type ? cfg.patterns[type] : undefined;
  const tokens = sms.payload ? tokensFor(sms.payload) : [];
  const paramNames = (pattern?.paramNames ?? "").split(",").map((s) => s.trim());
  return sendViaProvider(cfg.credentials, sms.to, sms.text, pattern?.patternCode ?? null, tokens, paramNames);
}

export function send(channel: Channel, n: Notification): Promise<SendResult> {
  // ستونِ channel هنوز email/bale را می‌پذیرد، ولی ارائه‌دهنده‌ای برایشان نیست: پیامکِ
  // اشتباهی به نشانیِ ایمیل نرود؛ ردیف با retry به dead-letter می‌رسد.
  if (channel !== "sms") return Promise.resolve({ ok: false, error: `کانالِ پشتیبانی‌نشده: ${channel}` });
  return sendSms(n);
}

/** متنِ پیام از payload. جدا نگه داشته شده تا قالب‌ها یک‌جا باشند. */
export function renderMessage(payload: Record<string, unknown>): string {
  if (payload.type === "restock")
    return `موجود شد: ${payload.product} (${payload.code}). برای رزرو وارد پنل شوید.`;
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
  if (payload.type === "restock") return "اعلانِ موجودی";
  return "اعلانِ جدید";
}
