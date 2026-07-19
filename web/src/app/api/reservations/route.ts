import { NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { currentUserId } from "@/auth/session";
import { authorizeAgent, authorizeStaff, AuthzError } from "@/auth/authz";
import { checkRate, tooMany } from "@/auth/rateLimit";
import { reserve, type ReserveItem } from "@/db/reservations";

/**
 * GET /api/reservations?tenantId[&agentAccountId]
 *  - با agentAccountId → رزروهای همان نماینده (صفحه‌ی «رزروهای من»)، gate: authorizeAgent.
 *  - بدون آن → رزروهای active همه‌ی نماینده‌ها برای تأیید (پنل staff)، gate: authorizeStaff.
 */
export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId") ?? "";
  const agentAccountId = url.searchParams.get("agentAccountId");
  const staffView = !agentAccountId;
  try {
    if (staffView) await authorizeStaff(userId, tenantId);
    else await authorizeAgent(userId, tenantId, agentAccountId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }
  const reservations = await withTenant(tenantId, (tx) =>
    tx`
      -- هرگز فقط به status تکیه نکن: worker انقضا ممکنه هنوز نرسیده باشه، پس وضعیتِ
      -- مؤثر همین‌جا مشتق می‌شه (هم‌راستا با تعریفِ held). spec ۱۴ / بخش ۵.۳.
      SELECT r.id,
        CASE WHEN r.status = 'active' AND r.expires_at <= now() THEN 'expired' ELSE r.status END AS status,
        r.expires_at AS "expiresAt", aa.legal_name AS "agentName",
        COALESCE(json_agg(json_build_object(
          'name', p.name, 'code', p.code, 'quantityBoxes', ri.quantity_boxes
        )) FILTER (WHERE ri.id IS NOT NULL), '[]') AS items
      FROM reservation r
      JOIN agent_account aa ON aa.id = r.agent_account_id
      LEFT JOIN reservation_item ri ON ri.reservation_id = r.id
      LEFT JOIN inventory_lot l ON l.id = ri.lot_id
      LEFT JOIN product_variant pv ON pv.id = l.variant_id
      LEFT JOIN product p ON p.id = pv.product_id
      WHERE r.tenant_id = ${tenantId}
        AND ${staffView
            // صفِ تأیید: فقط رزروِ واقعاً زنده — منقضی نباید به‌عنوان «در انتظار تأیید» دیده شه
            ? tx`r.status = 'active' AND r.expires_at > now()`
            : tx`r.agent_account_id = ${agentAccountId}`}
      GROUP BY r.id, aa.legal_name
      ORDER BY r.created_at DESC
      LIMIT 50`,
  );
  return NextResponse.json({ reservations });
}

/**
 * POST /api/reservations
 * ترتیب حیاتی: احراز هویت (کیه) → مجوز (chokepoint IDOR) → رزرو.
 * tenant/agent از body میان ولی *باور نمی‌شن* — authorizeAgent در برابر DB تأییدشون می‌کنه.
 * ttlHours از خودِ tenant خونده می‌شه، نه از کلاینت.
 */
export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { tenantId, agentAccountId, idempotencyKey, items } = body ?? {};
  if (
    typeof tenantId !== "string" ||
    typeof agentAccountId !== "string" ||
    typeof idempotencyKey !== "string" ||
    !Array.isArray(items) ||
    items.length === 0
  )
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // rate limit روی رزرو (spec ۸): جلوی hammer کردنِ مسیر پول/موجودی توسط یک کاربر
  const rl = checkRate(`reserve:${userId}`, 30, 60_000);
  if (!rl.ok) return tooMany(rl.retryAfterSec);

  let ctx;
  try {
    ctx = await authorizeAgent(userId, tenantId, agentAccountId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  const result = await reserve({
    tenantId: ctx.tenantId,
    agentAccountId: ctx.agentAccountId,
    ttlHours: ctx.ttlHours,
    idempotencyKey,
    items: items as ReserveItem[],
  });

  if (!result.ok) {
    if ("idempotencyMismatch" in result)
      // همون کلید با payload متفاوت — کلاینت باید کلید تازه بفرسته
      return NextResponse.json({ error: "idempotency_key_conflict" }, { status: 409 });
    // ۴۰۹ — کلاینت پیام «موجودی فعلی: X» می‌سازه (بخش ۱۱.۵ wireframe)
    return NextResponse.json({ error: "conflict", ...result.conflict }, { status: 409 });
  }

  return NextResponse.json(
    { reservationId: result.reservationId },
    { status: result.deduped ? 200 : 201 },
  );
}
