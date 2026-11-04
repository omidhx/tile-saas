import { redirect } from "next/navigation";

/** v6: با «گزارش‌ها» ادغام شد — این مسیر فقط برای بوکمارک/لینکِ قدیمی نگه داشته شده. */
export default function LedgerRedirect() {
  redirect("/staff/reports?tab=ledger");
}
