"use client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/states";

/** مرز خطای صفحه‌های تازه؛ بدون این، throw در رندر صفحه‌ی خام انگلیسی Next را نشان می‌داد. */
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto grid max-w-md gap-4 p-6">
      <Notice tone="error">یک خطای غیرمنتظره رخ داد.</Notice>
      <div className="flex justify-center gap-2">
        <Button onClick={reset}>تلاش دوباره</Button>
        <Button variant="outline" onClick={() => window.location.assign("/staff")}>بازگشت به کارتابل</Button>
      </div>
    </main>
  );
}
