import { withTenant } from "./client";
import { findOrCreateUser } from "./users";

export type Role = "staff" | "admin";

export type TeamMember = {
  membershipId: string; userId: string; phone: string; email: string | null; fullName: string | null;
  role: Role; isActive: boolean;
};

export type StaffOption = { userId: string; fullName: string | null; phone: string };

/** برای دراپ‌داونِ «پشتیبانِ ثابت» در فرمِ نمایندگی (db/agents.ts) — فقط staff/adminِ فعال. */
export async function listStaffOptions(tenantId: string): Promise<StaffOption[]> {
  return withTenant(tenantId, (tx) =>
    tx<StaffOption[]>`
      SELECT u.id AS "userId", u.full_name AS "fullName", u.phone
      FROM tenant_membership tm
      JOIN app_user u ON u.id = tm.user_id
      WHERE tm.tenant_id = ${tenantId} AND tm.role IN ('staff','admin') AND tm.is_active
      ORDER BY u.full_name, u.phone`,
  );
}

export type InviteResult =
  // created=false → کاربر از قبل بود، فقط عضویت اضافه/فعال شد؛ tempPassword فقط برای created=true
  // پر است — کاربرِ قدیمی رمزش عوض نمی‌شود. مدیر همین یک‌بار آن را روی صفحه می‌بیند
  // تا اگر پیامک/ایمیل هم نرسید، تلفنی/حضوری به کاربر بدهد.
  | { ok: true; created: boolean; tempPassword: string | null }
  | { ok: false; reason: "seat_limit" | "already_member" | "email_taken" };

/** اعضای تیمِ پشتیبان/مدیر (نمایندگی‌ها صفحه‌ی جدایند — db/agents.ts). */
export async function listTeam(tenantId: string): Promise<TeamMember[]> {
  return withTenant(tenantId, (tx) =>
    tx<TeamMember[]>`
      SELECT tm.id AS "membershipId", u.id AS "userId", u.phone, u.email, u.full_name AS "fullName",
             tm.role, tm.is_active AS "isActive"
      FROM tenant_membership tm
      JOIN app_user u ON u.id = tm.user_id
      WHERE tm.tenant_id = ${tenantId} AND tm.role IN ('staff','admin')
      ORDER BY tm.is_active DESC, u.phone
      -- «مدیریتِ همه‌ی تیم»ست، نه جستجو — سقفِ دفاعی، نه صفحه‌بندیِ واقعی.
      LIMIT 500`,
  );
}

/**
 * دعوتِ عضوِ تیم با موبایل (+ ایمیلِ اختیاری). اگر شماره از قبل در سامانه هست
 * (حتی برای tenantِ دیگر — app_user سراسری است)، رمزِ تازه ساخته نمی‌شود، فقط
 * عضویت اضافه/فعال می‌شود؛ کاربر با همان رمزِ قبلیِ خودش وارد می‌شود.
 * فقط برای کاربرِ **جدید** رمزِ یک‌بارمصرف ساخته و اعلان می‌شود.
 */
export async function inviteTeamMember(params: {
  tenantId: string; phone: string; email?: string | null; fullName?: string | null; role: Role;
}): Promise<InviteResult> {
  const { tenantId, phone, role } = params;
  const email = params.email?.trim() || null;
  const fullName = params.fullName?.trim() || null;

  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx<{ name: string; max_staff: number | null }[]>`
      SELECT name, max_staff FROM tenant WHERE id = ${tenantId}`;

    if (tenant.max_staff != null) {
      const [{ n }] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM tenant_membership
        WHERE tenant_id = ${tenantId} AND role IN ('staff','admin') AND is_active`;
      if (n >= tenant.max_staff) return { ok: false, reason: "seat_limit" };
    }

    const found = await findOrCreateUser(tx, phone, email, fullName);
    if (!found.ok) return found;
    const { userId, created, tempPassword } = found;

    const [member] = await tx<{ id: string; is_active: boolean }[]>`
      SELECT id, is_active FROM tenant_membership WHERE tenant_id = ${tenantId} AND user_id = ${userId}`;
    if (member) {
      if (member.is_active) return { ok: false, reason: "already_member" };
      // عضوِ قبلاً غیرفعال‌شده: بازگشت به تیم، با نقشِ تازه (شاید فرق کند)
      await tx`
        UPDATE tenant_membership SET is_active = true, role = ${role}
        WHERE id = ${member.id}`;
    } else {
      await tx`
        INSERT INTO tenant_membership (tenant_id, user_id, role, is_active)
        VALUES (${tenantId}, ${userId}, ${role}, true)`;
    }

    // اعلان: کاربرِ تازه رمزِ یک‌بارمصرف می‌گیرد؛ کاربرِ قدیمی فقط خبرِ دسترسیِ تازه.
    const payload = created
      ? { type: "team_invite", tenantName: tenant.name, identifier: phone, tempPassword }
      : { type: "team_invite", tenantName: tenant.name, identifier: phone, tempPassword: "— با رمزِ فعلیِ خود وارد شوید —" };
    await tx`
      INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
      VALUES (${tenantId}, 'sms', ${phone}, ${JSON.stringify(payload)}::jsonb)`;

    return { ok: true, created, tempPassword };
  });
}

export type SetMemberResult = { ok: true } | { ok: false; reason: "last_admin" };

/**
 * گاردِ مشترکِ setTeamMember/deleteTeamMember: حداقل یک adminِ فعال باید بماند،
 * وگرنه هیچ‌کس نمی‌تواند تیم/نمایندگی/انبار را مدیریت کند و کارخانه قفل می‌شود.
 */
async function guardLastAdmin(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string, membershipId: string,
): Promise<SetMemberResult | null> {
  const [target] = await tx<{ role: Role }[]>`
    SELECT role FROM tenant_membership WHERE id = ${membershipId} AND tenant_id = ${tenantId}`;
  if (target?.role !== "admin") return null;
  const [{ n }] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n FROM tenant_membership
    WHERE tenant_id = ${tenantId} AND role = 'admin' AND is_active AND id <> ${membershipId}`;
  return n === 0 ? { ok: false, reason: "last_admin" } : null;
}

/** تغییرِ نقش/فعال‌بودنِ عضوِ تیم، با گاردِ «حداقل یک adminِ فعال». */
export async function setTeamMember(params: {
  tenantId: string; membershipId: string; role?: Role; isActive?: boolean; fullName?: string;
}): Promise<SetMemberResult> {
  const { tenantId, membershipId } = params;
  return withTenant(tenantId, async (tx) => {
    if (params.isActive === false || params.role === "staff") {
      const blocked = await guardLastAdmin(tx, tenantId, membershipId);
      if (blocked) return blocked;
    }

    await tx`
      UPDATE tenant_membership SET
        role = COALESCE(${params.role ?? null}, role),
        is_active = COALESCE(${params.isActive ?? null}, is_active)
      WHERE id = ${membershipId} AND tenant_id = ${tenantId}`;
    // fullName صرفاً برچسبِ نمایشی است، نه اعتبارنامه — برخلافِ ایمیل، همیشه
    // قابلِ بازنویسی است (مدیر باید بتواند تایپوی نام را اصلاح کند).
    if (params.fullName !== undefined) {
      const [{ user_id }] = await tx<{ user_id: string }[]>`
        SELECT user_id FROM tenant_membership WHERE id = ${membershipId} AND tenant_id = ${tenantId}`;
      await tx`UPDATE app_user SET full_name = ${params.fullName.trim() || null} WHERE id = ${user_id}`;
    }
    return { ok: true };
  });
}

export type DeleteMemberResult = { ok: true } | { ok: false; reason: "last_admin" | "linked_to_agent" };

/** حذفِ واقعیِ عضویت (نه فقط غیرفعال‌کردن). app_user سراسری دست‌نخورده می‌ماند. */
export async function deleteTeamMember(params: { tenantId: string; membershipId: string }): Promise<DeleteMemberResult> {
  const { tenantId, membershipId } = params;
  return withTenant(tenantId, async (tx) => {
    const blocked = await guardLastAdmin(tx, tenantId, membershipId);
    if (blocked) return blocked;

    const [target] = await tx<{ user_id: string }[]>`
      SELECT user_id FROM tenant_membership WHERE id = ${membershipId} AND tenant_id = ${tenantId}`;
    if (!target) return { ok: true }; // از قبل نبوده — idempotent

    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM agent_account_user WHERE tenant_id = ${tenantId} AND user_id = ${target.user_id}`;
    if (n > 0) return { ok: false, reason: "linked_to_agent" };

    await tx`DELETE FROM tenant_membership WHERE id = ${membershipId} AND tenant_id = ${tenantId}`;
    return { ok: true };
  });
}
