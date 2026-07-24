import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeAdmin, AuthzError } from "@/auth/authz";
import { listTeam, inviteTeamMember, setTeamMember, type Role } from "@/db/team";

async function requireAdmin(tenantId: string) {
  const userId = await currentUserId();
  if (!userId) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  try {
    await authorizeAdmin(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    throw e;
  }
  return { userId };
}

/** GET /api/team?tenantId — فهرستِ اعضای تیمِ پشتیبان/مدیر. admin-only. */
export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenantId") ?? "";
  const auth = await requireAdmin(tenantId);
  if (auth.error) return auth.error;
  return NextResponse.json({ members: await listTeam(tenantId) });
}

/** POST /api/team — دعوتِ عضوِ تیم با موبایل(+ایمیل). admin-only. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, phone, email, role } = body ?? {};
  if (typeof tenantId !== "string" || typeof phone !== "string" || !phone.trim()
    || (role !== "staff" && role !== "admin"))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (email != null && (typeof email !== "string" || !email.includes("@")))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await requireAdmin(tenantId);
  if (auth.error) return auth.error;

  const r = await inviteTeamMember({ tenantId, phone: phone.trim(), email, role: role as Role });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "seat_limit" ? 403 : 409 });
  return NextResponse.json({ ok: true, created: r.created, tempPassword: r.tempPassword }, { status: 201 });
}

/** PATCH /api/team — تغییرِ نقش/فعال‌بودنِ عضو. admin-only. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, membershipId, role, isActive } = body ?? {};
  if (typeof tenantId !== "string" || typeof membershipId !== "string"
    || (role !== undefined && role !== "staff" && role !== "admin")
    || (isActive !== undefined && typeof isActive !== "boolean"))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await requireAdmin(tenantId);
  if (auth.error) return auth.error;

  const r = await setTeamMember({ tenantId, membershipId, role, isActive });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
