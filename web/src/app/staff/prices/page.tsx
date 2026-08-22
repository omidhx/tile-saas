import { redirect } from "next/navigation";

/** v6: با «محصول و موجودی» ادغام شد — این مسیر فقط برای بوکمارک/لینکِ قدیمی نگه داشته شده. */
export default function PricesRedirect() {
  redirect("/staff/catalog?tab=prices");
}
