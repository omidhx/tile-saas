import { NextResponse } from "next/server";
import { z } from "zod";
import { adminCtx } from "@/auth/httpCtx";
import { id, parse } from "@/lib/validate";
import { listTeam, inviteTeamMember, setTeamMember, deleteTeamMember } from "@/db/team";

const role = z.enum(["staff", "admin"]);
const Invite = z.object({
  phone: z.string().trim().min(1),
  email: z.string().trim().includes("@").nullish(),
  fullName: z.string().nullish(),
  role,
});
const Update = z.object({ membershipId: id, role: role.optional(), isActive: z.boolean().optional(), fullName: z.string().optional() });
const Remove = z.object({ membershipId: id });

/** GET /api/team?tenantId — فهرستِ اعضای تیمِ پشتیبان/مدیر. فقط admin. */
export async function GET(req: Request) {
  const tenantId = new URL(req.url).searchParams.get("tenantId") ?? "";
  const auth = await adminCtx(tenantId);
  if ("err" in auth) return auth.err;
  return NextResponse.json({ members: await listTeam(tenantId) });
}

/** POST /api/team — دعوتِ عضوِ تیم با موبایل(+ایمیل). فقط admin. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const auth = await adminCtx(body?.tenantId);
  if ("err" in auth) return auth.err;
  const p = parse(Invite, body);
  if ("err" in p) return p.err;

  const r = await inviteTeamMember({ tenantId: auth.tenantId, ...p.data });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "seat_limit" ? 403 : 409 });
  return NextResponse.json({ ok: true, created: r.created, tempPassword: r.tempPassword }, { status: 201 });
}

/** PATCH /api/team — تغییرِ نقش/فعال‌بودنِ عضو. فقط admin. */
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const auth = await adminCtx(body?.tenantId);
  if ("err" in auth) return auth.err;
  const p = parse(Update, body);
  if ("err" in p) return p.err;

  const r = await setTeamMember({ tenantId: auth.tenantId, ...p.data });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.reason === "not_found" ? 404 : 409 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/team — حذفِ واقعیِ عضویت (نه فقط غیرفعال‌سازی). فقط admin. */
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => null);
  const auth = await adminCtx(body?.tenantId);
  if ("err" in auth) return auth.err;
  const p = parse(Remove, body);
  if ("err" in p) return p.err;

  const r = await deleteTeamMember({ tenantId: auth.tenantId, membershipId: p.data.membershipId });
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: 409 });
  return NextResponse.json({ ok: true });
}
