import { NextResponse } from "next/server";

/**
 * GET /api/health — Liveness probe.
 *
 * فقط بررسی می‌کند که process زنده است و می‌تواند پاسخ HTTP بدهد.
 * DB را چک نمی‌کند — برای تشخیصِ readiness از /api/ready استفاده کنید.
 *
 * تفاوت liveness و readiness:
 *   - Liveness: آیا process زنده است؟ (load balancer اگر fail شود، restart می‌کند)
 *   - Readiness: آیا سرویس واقعاً می‌تواند request معتبر پاسخ دهد؟ (load balancer
 *     اگر fail شود، ترافیک را نمی‌فرستد ولی restart نمی‌کند)
 *
 * این endpoint احراز هویت لازم ندارد و اطلاعات حساسی نمی‌دهد.
 */
export async function GET() {
  return NextResponse.json(
    { status: "ok", timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
