/**
 * fetchِ JSON که شکست را **قورت نمی‌دهد**.
 *
 * چرا وجود دارد: الگوی `if (res.ok) setX(...)` روی خطا حالتِ خالی نشان می‌دهد، و
 * صفحه بی‌سروصدا دروغ می‌گوید — مثلاً پنل staff می‌گوید «رزروی برای تأیید نیست»
 * در حالی که درخواست ۴۰۳ خورده و نماینده منتظر تأیید است. «خالی» باید از «نشد» جدا بماند.
 */
export type Loaded<T> = { ok: true; data: T } | { ok: false; status: number };

export async function getJson<T>(url: string): Promise<Loaded<T>> {
  try {
    const res = await fetch(url);
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0 }; // خطای شبکه/قطعی
  }
}

/** پیام فارسیِ خطای بارگذاری. ۰ = به سرور نرسیدیم. */
export function loadError(status: number): string {
  if (status === 0) return "ارتباط با سرور برقرار نشد.";
  if (status === 403) return "دسترسی این بخش را نداری.";
  if (status === 401) return "نشست منقضی شده — دوباره وارد شو.";
  return `بارگذاری ناموفق (${status}).`;
}

/**
 * نوشتنِ JSON که شکست را **قورت نمی‌دهد**. مکملِ `getJson` برای POST/PATCH/DELETE.
 *
 * چرا لازم است: عملیاتِ نوشتنِ staff (تأیید، لغو، حواله) اگر ۴۰۹/۴۰۳ بخورد و فقط
 * `load()` صدا زده شود، رزرو **هنوز آنجاست** — پشتیبان دوباره کلیک می‌کند، باز هیچ،
 * و نمی‌فهمد چرا. شکستِ عملیاتِ پول نباید خاموش باشد.
 */
export type WriteResult = { ok: true; data: unknown } | { ok: false; status: number; error?: string };

export async function postJson(
  url: string, body: unknown, method: "POST" | "PATCH" | "DELETE" | "PUT" = "POST",
): Promise<WriteResult> {
  try {
    const res = await fetch(url, {
      method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    // error: کدِ رشته‌ایِ سرور (مثلاً "seat_limit") — صفحه‌هایی که چند دلیلِ رد
    // متفاوت دارند (نه فقط ۴۰۹/۴۰۳ عمومی) از همین می‌خوانند، وگرنه actionError(status).
    if (!res.ok) return { ok: false, status: res.status, error: typeof json?.error === "string" ? json.error : undefined };
    return { ok: true, data: json };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** پیام فارسیِ خطای عملیات (نوشتن). ۴۰۹ جدا چون «تعارض» است نه «شکست». */
export function actionError(status: number): string {
  if (status === 0) return "ارتباط با سرور برقرار نشد.";
  if (status === 409) return "این مورد همین حالا تغییر کرد (شاید منقضی/تأیید شد). فهرست به‌روز شد.";
  if (status === 403) return "اجازه‌ی این کار را نداری.";
  if (status === 401) return "نشست منقضی شده — دوباره وارد شو.";
  return `انجام نشد (خطای ${status}).`;
}
