import * as XLSX from "xlsx";

/**
 * خروجیِ اکسل — کاملاً سمتِ کلاینت، همان `xlsx` که `/staff/catalog` برای پارسِ
 * ورودی استفاده می‌کند (بدونِ کتابخانه‌ی تازه). حسابدارِ کارخانه با اکسل کار
 * می‌کند، نه با UI؛ چند شیت در یک فایل (مثلاً چند بخشِ یک گزارش).
 */
export function exportXlsx(filename: string, sheets: Record<string, Record<string, unknown>[]>) {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    // نامِ شیت در اکسل حداکثر ۳۱ کاراکتر است — برش بی‌سروصدا بهتر از خطاست
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}
