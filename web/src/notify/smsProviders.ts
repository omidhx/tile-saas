import type { SendResult } from "./sender";

/**
 * رجیستریِ پروایدرهای پیامکِ ایرانی — هر tenant یکی را از UI انتخاب می‌کند
 * (spec v10 «پنلِ پیامکیِ خودِ کارخانه»، دقیقاً مثلِ افزونه‌های SMS در وردپرس).
 *
 * دو مدلِ متفاوتِ پترن در پروایدرهای واقعی هست:
 *   - **موقعیتی** (فقط کاوه‌نگار): توکن‌ها به ترتیب token/token2/token3 — حداکثر ۳ تا.
 *   - **نام‌دار** (بقیه): هر پترن روی پنلِ پروایدر پارامترهایی با نامِ دلخواه دارد
 *     (مثلاً %Code%) که ما نمی‌دانیم کاربر چه اسمی رویش گذاشته.
 * برای مدلِ نام‌دار، `paramNames` (نامِ پارامترها به ترتیبِ همان توکن‌ها، جدا با کاما)
 * را خودِ کاربر در تنظیماتِ پترن وارد می‌کند — راهِ عمومی که برای هر پروایدرِ
 * نام‌دار جواب می‌دهد بدونِ حدسِ اسمِ پارامترهایش.
 *
 * ponytail: پیاده‌سازی‌ها طبقِ مستنداتِ عمومیِ هر پروایدر است، نه تست‌شده روی
 * اکانتِ واقعی (اعتبارنامه نداریم) — اگر پاسخِ provider ساختارِ متفاوتی داشت،
 * پیامِ خطا از همان provider در `error` برمی‌گردد تا کاربر سریع بفهمد.
 */

export type SmsProviderId = "kavenegar" | "ippanel" | "melipayamak" | "smsir" | "farazsms";

export type SmsCredentials = {
  provider: SmsProviderId;
  apiKey?: string;
  username?: string;
  password?: string;
  senderNumber: string;
};

export type SmsProviderMeta = {
  id: SmsProviderId;
  label: string;
  fields: Array<"apiKey" | "username" | "password">;
  needsParamNames: boolean; // یعنی UI باید فیلدِ «نامِ پارامترها» را هم برای این پروایدر نشان بدهد
};

export const SMS_PROVIDERS: SmsProviderMeta[] = [
  { id: "kavenegar", label: "کاوه‌نگار", fields: ["apiKey"], needsParamNames: false },
  { id: "ippanel", label: "آی‌پی‌پنل (IPPanel)", fields: ["apiKey"], needsParamNames: true },
  { id: "melipayamak", label: "ملی‌پیامک", fields: ["username", "password"], needsParamNames: false },
  { id: "smsir", label: "sms.ir", fields: ["apiKey"], needsParamNames: true },
  { id: "farazsms", label: "فراز اس‌ام‌اس", fields: ["apiKey"], needsParamNames: true },
];

async function getJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function sendKavenegar(
  creds: SmsCredentials, to: string, text: string, patternCode: string | null, tokens: string[],
): Promise<SendResult> {
  const base = `https://api.kavenegar.com/v1/${creds.apiKey}`;
  const url = patternCode
    ? `${base}/verify/lookup.json?receptor=${encodeURIComponent(to)}&template=${encodeURIComponent(patternCode)}`
      + tokens.slice(0, 3).map((t, i) => `&token${i === 0 ? "" : i + 1}=${encodeURIComponent(t)}`).join("")
    : `${base}/sms/send.json?receptor=${encodeURIComponent(to)}&sender=${encodeURIComponent(creds.senderNumber)}`
      + `&message=${encodeURIComponent(text)}`;
  const { res, body } = await getJson(url);
  if (!res.ok || body?.return?.status !== 200)
    return { ok: false, error: body?.return?.message ?? `کاوه‌نگار: HTTP ${res.status}` };
  return { ok: true };
}

// طبقِ مستنداتِ رسمیِ Edge API (ippanelcom.github.io/Edge-Document): یک endpoint واحد
// (`/v1/api/send`) با `sending_type` که فرق می‌کند؛ موفقیت از `meta.status` خوانده می‌شود.
async function sendIppanel(
  creds: SmsCredentials, to: string, text: string, patternCode: string | null,
  tokens: string[], paramNames: string[],
): Promise<SendResult> {
  const url = "https://edge.ippanel.com/v1/api/send";
  const body = patternCode
    ? {
        sending_type: "pattern", from_number: creds.senderNumber, code: patternCode, recipients: [to],
        params: Object.fromEntries(paramNames.map((name, i) => [name || `var${i + 1}`, tokens[i] ?? ""])),
      }
    : { sending_type: "webservice", from_number: creds.senderNumber, message: text, params: { recipients: [to] } };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: creds.apiKey ?? "" },
    body: JSON.stringify(body),
  });
  const respBody = await res.json().catch(() => null);
  if (!res.ok || respBody?.meta?.status !== true)
    return { ok: false, error: respBody?.meta?.message ?? `IPPanel: HTTP ${res.status}` };
  return { ok: true };
}

async function sendMelipayamak(
  creds: SmsCredentials, to: string, text: string, patternCode: string | null, tokens: string[],
): Promise<SendResult> {
  const url = patternCode
    ? "https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber"
    : "https://rest.payamak-panel.com/api/SendSMS/SendSMS";
  const body = patternCode
    ? { username: creds.username, password: creds.password, text: tokens.join(";"), to, bodyId: patternCode }
    : { username: creds.username, password: creds.password, to, from: creds.senderNumber, text };
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const respBody = await res.json().catch(() => null);
  if (!res.ok || (respBody?.RetStatus !== undefined && respBody.RetStatus !== 1))
    return { ok: false, error: respBody?.StrRetStatus ?? `ملی‌پیامک: HTTP ${res.status}` };
  return { ok: true };
}

async function sendSmsIr(
  creds: SmsCredentials, to: string, text: string, patternCode: string | null,
  tokens: string[], paramNames: string[],
): Promise<SendResult> {
  const url = patternCode ? "https://api.sms.ir/v1/send/verify" : "https://api.sms.ir/v1/send/bulk";
  const body = patternCode
    ? {
        mobile: to, templateId: Number(patternCode),
        parameters: paramNames.map((name, i) => ({ name: name || `Param${i + 1}`, value: tokens[i] ?? "" })),
      }
    : { lineNumber: creds.senderNumber, messageText: text, mobiles: [to] };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": creds.apiKey ?? "" },
    body: JSON.stringify(body),
  });
  const respBody = await res.json().catch(() => null);
  if (!res.ok || respBody?.status !== 1) return { ok: false, error: respBody?.message ?? `sms.ir: HTTP ${res.status}` };
  return { ok: true };
}

// فراز اس‌ام‌اس = FarazSMS/IranPayamak — طبقِ docs.iranpayamak.com و کلاینتِ رسمیِ PHP
// (github.com/ghaffari273/farazsms-php): بیسِ api.iranpayamak.com، هدرِ Api-Key،
// و موفقیت از status==="success" خوانده می‌شود.
async function sendFarazsms(
  creds: SmsCredentials, to: string, text: string, patternCode: string | null,
  tokens: string[], paramNames: string[],
): Promise<SendResult> {
  const base = "https://api.iranpayamak.com/ws/v1/sms";
  const url = patternCode ? `${base}/pattern` : `${base}/simple`;
  const body = patternCode
    ? {
        code: patternCode, recipient: to, line_number: creds.senderNumber, number_format: "english",
        attributes: Object.fromEntries(paramNames.map((name, i) => [name || `param${i + 1}`, tokens[i] ?? ""])),
      }
    : { text, recipients: [to], line_number: creds.senderNumber, number_format: "english" };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Api-Key": creds.apiKey ?? "" },
    body: JSON.stringify(body),
  });
  const respBody = await res.json().catch(() => null);
  if (!res.ok || respBody?.status !== "success")
    return { ok: false, error: (Array.isArray(respBody?.messages) ? respBody.messages.join(", ") : respBody?.messages) ?? `فراز اس‌ام‌اس: HTTP ${res.status}` };
  return { ok: true };
}

/** یک پیام (متن یا پترن) را از طریقِ پنلِ پیامکیِ tenant می‌فرستد. */
export function sendViaProvider(
  creds: SmsCredentials, to: string, text: string,
  patternCode: string | null, tokens: string[], paramNames: string[],
): Promise<SendResult> {
  switch (creds.provider) {
    case "kavenegar": return sendKavenegar(creds, to, text, patternCode, tokens);
    case "ippanel": return sendIppanel(creds, to, text, patternCode, tokens, paramNames);
    case "melipayamak": return sendMelipayamak(creds, to, text, patternCode, tokens);
    case "smsir": return sendSmsIr(creds, to, text, patternCode, tokens, paramNames);
    case "farazsms": return sendFarazsms(creds, to, text, patternCode, tokens, paramNames);
  }
}
