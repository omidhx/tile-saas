/**
 * آیکن‌های درون‌خطی (Lucide، ۲۴×۲۴، stroke).
 *
 * چرا SVG و نه ایموجی: ایموجی روی هر سیستم شکلِ دیگری دارد (ویندوز ۷/۱۰ که در
 * ایران هنوز رایج است ⚠️ را زرد-مسطح و ⏳ را گاهی مربعِ خالی نشان می‌دهد)، رنگش
 * را از توکن نمی‌گیرد، و صفحه‌خوان اسمِ کاملش را بلند می‌خواند.
 * اینجا `currentColor` می‌گیرند، پس با بنر و badge هم‌رنگ می‌شوند.
 *
 * ponytail: کتابخانه‌ی آیکن نصب نکردم — شش آیکن لازم داریم و هر کدام یک path است.
 */

type Props = { name: IconName; size?: number; className?: string };

export type IconName =
  | "alert"      // خطا / هشدار
  | "check"      // موفق / تراز
  | "clock"      // مهلت، در انتظار
  | "bell"       // خبرم کن
  | "info"       // توضیح
  | "warehouse"  // انبار
  | "queue"      // نوبت در صف
  | "menu"       // بازکردنِ منو
  | "close"      // بستنِ منو
  | "image"      // افزودنِ عکس به گالری
  | "printer";   // چاپِ حواله

const PATHS: Record<IconName, React.ReactNode> = {
  alert: <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  warehouse: <><path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" /><path d="M6 18h12" /><path d="M6 14h12" /></>,
  queue: <><path d="M3 6h18" /><path d="M3 12h12" /><path d="M3 18h6" /></>,
  menu: <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></>,
  printer: <><path d="M6 9V2h12v7" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>,
};

export default function Icon({ name, size = 16, className }: Props) {
  return (
    <svg
      className={className} width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      // تزئینی است: معنی همیشه در متنِ کنارش هست، پس صفحه‌خوان نباید دوباره بخواند
      aria-hidden="true" focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
