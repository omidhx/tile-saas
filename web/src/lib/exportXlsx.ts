/**
 * خروجیِ اکسل — کاملاً سمتِ کلاینت، همان `xlsx` که `/staff/catalog` برای پارسِ
 * ورودی استفاده می‌کند (بدونِ کتابخانه‌ی تازه). حسابدارِ کارخانه با اکسل کار
 * می‌کند، نه با UI؛ چند شیت در یک فایل (مثلاً چند بخشِ یک گزارش).
 *
 * import پویا: `xlsx` (~۷۰۰KB) فقط وقتی لازم است که کاربر واقعاً خروجی بگیرد —
 * وگرنه در باندلِ هر صفحه‌ای که دکمه‌ی «خروجیِ اکسل» دارد می‌نشیند، حتی برای
 * کاربری که هرگز کلیکش نمی‌کند.
 */
export async function exportXlsx(filename: string, sheets: Record<string, Record<string, unknown>[]>) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    // نامِ شیت در اکسل حداکثر ۳۱ کاراکتر است — برش بی‌سروصدا بهتر از خطاست
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}
