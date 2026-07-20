import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaff, AuthzError } from "@/auth/authz";
import { withTenant } from "@/db/client";

/**
 * سقفِ تأییدِ خودکار (v2 «تأیید هیبریدی»). فقط staff.
 *
 * قرارداد مقادیر — همان معنایی که در schema رمزگذاری شده:
 *   null → کارخانه: خاموش | نماینده: ارث از کارخانه
 *   ۰    → نماینده: هرگز خودکار
 */

type Body = { tenantId?: unknown; scope?: unknown; agentAccountId?: unknown; limit?: unknown };

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const tenantId = new URL(req.url).searchParams.get("tenantId") ?? "";
  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  return NextResponse.json(await withTenant(tenantId, async (tx) => {
    const [tenant] = await tx<{ limit: string | null }[]>`
      SELECT auto_approve_limit AS limit FROM tenant WHERE id = ${tenantId}`;
    const agents = await tx<{ id: string; name: string; limit: string | null }[]>`
      SELECT id, legal_name AS name, auto_approve_limit AS limit
      FROM agent_account WHERE tenant_id = ${tenantId} AND is_active
      ORDER BY legal_name`;
    return {
      tenantLimit: tenant?.limit === null || tenant?.limit === undefined ? null : Number(tenant.limit),
      agents: agents.map((a) => ({ ...a, limit: a.limit === null ? null : Number(a.limit) })),
    };
  }));
}

export async function PUT(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body: Body = await req.json().catch(() => ({}));
  const { tenantId, scope, agentAccountId, limit } = body;
  if (typeof tenantId !== "string" || (scope !== "tenant" && scope !== "agent"))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // مسیرِ پول: مقدارِ نامعتبر باید رد شود، نه اینکه بی‌سروصدا به NULL/NaN تبدیل شود —
  // NULL یعنی «خاموش»، و رسیدنِ تصادفی به آن سقف را برمی‌دارد.
  if (limit !== null && (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0))
    return NextResponse.json({ error: "invalid limit" }, { status: 400 });
  if (scope === "agent" && typeof agentAccountId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  try {
    await authorizeStaff(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw e;
  }

  await withTenant(tenantId, async (tx) => {
    if (scope === "tenant") {
      await tx`UPDATE tenant SET auto_approve_limit = ${limit} WHERE id = ${tenantId}`;
    } else {
      await tx`
        UPDATE agent_account SET auto_approve_limit = ${limit}
        WHERE id = ${agentAccountId as string} AND tenant_id = ${tenantId}`;
    }
  });

  return NextResponse.json({ ok: true });
}
