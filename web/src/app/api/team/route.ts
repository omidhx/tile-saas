import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeAccessManager, AuthzError } from "@/auth/authz";
import { listTeam, inviteTeamMember, setTeamMember, deleteTeamMember, type Role } from "@/db/team";
import { STAFF_PAGE_KEYS } from "@/lib/staffPages";

/** همه‌ی متدهای این فایل «معاونِ مدیر» می‌خواهند — adminِ ساده کافی نیست (v4). */
async function requireAccessManager(tenantId: string) {
  const userId = await currentUserId();
  if (!userId) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  try {
    await authorizeAccessManager(userId, tenantId);
  } catch (e) {
    if (e instanceof AuthzError) return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    throw e;
  }
  return { userId };
}

function validAllowedPages(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((p) => typeof p === "string" && STAFF_PAGE_KEYS.includes(p));
}

/** GET /api/team?tenantId — فهرستِ اعضای تیمِ پشتیبان/مدیر. فقط معاونِ مدیر. */
export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenantId") ?? "";
  const auth = await requireAccessManager(tenantId);
  if (auth.error) return auth.error;
  return NextResponse.json({ members: await listTeam(tenantId) });
}

/** POST /api/team — دعوتِ عضوِ تیم با موبایل(+ایمیل). فقط معاونِ مدیر. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, phone, email, role, canManageAccess, allowedPages } = body ?? {};
  if (typeof tenantId !== "string" || typeof phone !== "string" || !phone.trim()
    || (role !== "staff" && role !== "admin"))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (email != null && (typeof email !== "string" || !email.includes("@")))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (canManageAccess !== undefined && typeof canManageAccess !== "boolean")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (allowedPages !== undefined && !validAllowedPages(allowedPages))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await requireAccessManager(tenantId);
  if (auth.error) return auth.error;

  const r = await inviteTeamMember({ tenantId, phone: phone.trim(), email, role: role as Role, canManageAccess, allowedPages });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "seat_limit" ? 403 : 409 });
  return NextResponse.json({ ok: true, created: r.created, tempPassword: r.tempPassword }, { status: 201 });
}

/** PATCH /api/team — تغییرِ نقش/فعال‌بودن/دسترسیِ عضو. فقط معاونِ مدیر. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, membershipId, role, isActive, canManageAccess, allowedPages } = body ?? {};
  if (typeof tenantId !== "string" || typeof membershipId !== "string"
    || (role !== undefined && role !== "staff" && role !== "admin")
    || (isActive !== undefined && typeof isActive !== "boolean")
    || (canManageAccess !== undefined && typeof canManageAccess !== "boolean")
    || (allowedPages !== undefined && !validAllowedPages(allowedPages)))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await requireAccessManager(tenantId);
  if (auth.error) return auth.error;

  const r = await setTeamMember({ tenantId, membershipId, role, isActive, canManageAccess, allowedPages });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/team — حذفِ واقعیِ عضویت (نه فقط غیرفعال‌سازی). فقط معاونِ مدیر. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, membershipId } = body ?? {};
  if (typeof tenantId !== "string" || typeof membershipId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await requireAccessManager(tenantId);
  if (auth.error) return auth.error;

  const r = await deleteTeamMember({ tenantId, membershipId });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
