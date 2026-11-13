import { redirect } from "next/navigation";

/** v8: با «راه‌اندازی» ادغام شد — این مسیر فقط برای بوکمارک/لینکِ قدیمی نگه داشته شده. */
export default function AutoApproveRedirect() {
  redirect("/staff/team?tab=auto-approve");
}
