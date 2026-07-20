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
