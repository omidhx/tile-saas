import { NextResponse } from "next/server";
import { adminCtx } from "@/auth/httpCtx";
import { listTeam, inviteTeamMember, setTeamMember, deleteTeamMember, type Role } from "@/db/team";

/** GET /api/team?tenantId — فهرستِ اعضای تیمِ پشتیبان/مدیر. فقط admin. */
export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenantId") ?? "";
  const auth = await adminCtx(tenantId);
  if ("err" in auth) return auth.err;
  return NextResponse.json({ members: await listTeam(tenantId) });
}

/** POST /api/team — دعوتِ عضوِ تیم با موبایل(+ایمیل). فقط admin. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, phone, email, fullName, role } = body ?? {};
  if (typeof tenantId !== "string" || typeof phone !== "string" || !phone.trim()
    || (role !== "staff" && role !== "admin"))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (email != null && (typeof email !== "string" || !email.includes("@")))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (fullName != null && typeof fullName !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await adminCtx(tenantId);
  if ("err" in auth) return auth.err;

  const r = await inviteTeamMember({ tenantId, phone: phone.trim(), email, fullName, role: role as Role });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "seat_limit" ? 403 : 409 });
  return NextResponse.json({ ok: true, created: r.created, tempPassword: r.tempPassword }, { status: 201 });
}

/** PATCH /api/team — تغییرِ نقش/فعال‌بودنِ عضو. فقط admin. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, membershipId, role, isActive, fullName } = body ?? {};
  if (typeof tenantId !== "string" || typeof membershipId !== "string"
    || (role !== undefined && role !== "staff" && role !== "admin")
    || (isActive !== undefined && typeof isActive !== "boolean")
    || (fullName !== undefined && typeof fullName !== "string"))
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await adminCtx(tenantId);
  if ("err" in auth) return auth.err;

  const r = await setTeamMember({ tenantId, membershipId, role, isActive, fullName });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/team — حذفِ واقعیِ عضویت (نه فقط غیرفعال‌سازی). فقط admin. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tenantId, membershipId } = body ?? {};
  if (typeof tenantId !== "string" || typeof membershipId !== "string")
    return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const auth = await adminCtx(tenantId);
  if ("err" in auth) return auth.err;

  const r = await deleteTeamMember({ tenantId, membershipId });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
