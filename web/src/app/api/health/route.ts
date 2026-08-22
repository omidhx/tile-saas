import { NextResponse } from "next/server";
import { sql } from "@/db/client";

/**
 * GET /api/health — بررسیِ سلامتِ اپ.
 *
 * چرا این endpoint لازم است: Docker healthcheck و reverse proxy (Caddy/Nginx)
 * باید بتوانند تشخیص دهند که اپ واقعاً سالم است، نه فقط پورت باز است.
 * `GET /` هم می‌شود ولی آن redirect می‌زند و ممکن است با cache رفتار عجیب کند.
 *
 * این endpoint:
 *   - DB را با یک کوئریِ سبک (`SELECT 1`) چک می‌کند.
 *   - اگر DB در دسترس نباشد، 503 برمی‌گرداند (نه 500 — برای load balancerها).
 *   - احراز هویت لازم ندارد — اطلاعاتِ حساسی برنمی‌گرداند.
 *
 * ponytail: این endpoint اطلاعاتِ version یا ساختارِ داخلی نمی‌دهد — فقط
 * "ok" یا "down". مهاجم نباید از این endpoint برای discovery استفاده کند.
 */
export async function GET() {
  try {
    const [row] = await sql<{ ok: number }[]>`SELECT 1 AS ok`;
    if (!row || row.ok !== 1) {
      return NextResponse.json(
        { status: "down", reason: "db_unexpected_response" },
        { status: 503 },
      );
    }
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { status: "down", reason: "db_unreachable" },
      { status: 503 },
    );
  }
}
