/**
 * فهرستِ صفحه‌های عملیاتیِ پنلِ پشتیبان که دسترسیِ ریزدانه رویشان معنا دارد (v4).
 *
 * جای دیگر: صفحه‌ی /staff (داشبوردِ اصلی: تأیید/حواله/backorder) و
 * /staff/team و /staff/agents و /staff/warehouses عمداً اینجا نیستند — آن سه‌تا
 * جدا و فقط برای admin/مدیرِ دسترسی گیت می‌شوند، نه بخشی از این چک‌لیست.
 *
 * کلاینت (صفحه‌ی /staff/team برای چک‌لیست، و خودِ هر صفحه برای گیت) و سرور
 * (authorizeStaffPage) از همین یک فهرست می‌خوانند تا کلید‌ها هیچ‌وقت جفت‌نشده نمانند.
 */
export const STAFF_PAGES = [
  { key: "import", label: "ورود موجودی از اکسل" },
  { key: "incoming", label: "موجودی در راه" },
  { key: "customers", label: "مشتریان" },
  { key: "prices", label: "قیمت‌گذاری" },
  { key: "auto-approve", label: "تأیید خودکار" },
  { key: "substitutes", label: "کالای جایگزین" },
  { key: "catalog", label: "مدیریت محصول" },
  { key: "reports", label: "گزارش‌های مدیریتی" },
  { key: "ledger", label: "دفتر حرکات موجودی" },
  { key: "audit", label: "دفتر تغییرات" },
] as const;

export type StaffPageKey = (typeof STAFF_PAGES)[number]["key"];
export const STAFF_PAGE_KEYS: readonly string[] = STAFF_PAGES.map((p) => p.key);

/** آیا این کاربر به صفحه‌ی pageKey دسترسی دارد؟ allowedPages خالی = دسترسیِ کامل. */
export const hasPageAccess = (allowedPages: string[], pageKey: string): boolean =>
  allowedPages.length === 0 || allowedPages.includes(pageKey);
