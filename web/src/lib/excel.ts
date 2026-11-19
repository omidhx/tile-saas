/**
 * خروجی Excel راست‌به‌چپ از هر فهرست (فاز ۷). xlsx پویا بارگذاری می‌شود (~۷۰۰KB) تا فقط با کلیک بیاید.
 * عددها عدد می‌مانند (نه رشته‌ی فارسی) تا در Excel جمع زده شوند.
 */
export async function exportExcel(filename: string, header: string[], rows: (string | number | null)[][]) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  ws["!cols"] = header.map((h, i) => ({ wch: Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)) + 2 }));
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}
