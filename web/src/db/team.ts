import { withTenant } from "./client";
import { findOrCreateUser } from "./users";

export type Role = "staff" | "admin";

export type TeamMember = {
  membershipId: string; userId: string; phone: string; email: string | null;
  role: Role; isActive: boolean;
};

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
      SELECT tm.id AS "membershipId", u.id AS "userId", u.phone, u.email,
             tm.role, tm.is_active AS "isActive"
      FROM tenant_membership tm
      JOIN app_user u ON u.id = tm.user_id
      WHERE tm.tenant_id = ${tenantId} AND tm.role IN ('staff','admin')
      ORDER BY tm.is_active DESC, u.phone`,
  );
}

/**
 * دعوتِ عضوِ تیم با موبایل (+ ایمیلِ اختیاری). اگر شماره از قبل در سامانه هست
 * (حتی برای tenantِ دیگر — app_user سراسری است)، رمزِ تازه ساخته نمی‌شود، فقط
 * عضویت اضافه/فعال می‌شود؛ کاربر با همان رمزِ قبلیِ خودش وارد می‌شود.
 * فقط برای کاربرِ **جدید** رمزِ یک‌بارمصرف ساخته و اعلان می‌شود.
 */
export async function inviteTeamMember(params: {
  tenantId: string; phone: string; email?: string | null; role: Role;
}): Promise<InviteResult> {
  const { tenantId, phone, role } = params;
  const email = params.email?.trim() || null;

  return withTenant(tenantId, async (tx) => {
    const [tenant] = await tx<{ name: string; max_staff: number | null }[]>`
      SELECT name, max_staff FROM tenant WHERE id = ${tenantId}`;

    if (tenant.max_staff != null) {
      const [{ n }] = await tx<{ n: number }[]>`
        SELECT count(*)::int AS n FROM tenant_membership
        WHERE tenant_id = ${tenantId} AND role IN ('staff','admin') AND is_active`;
      if (n >= tenant.max_staff) return { ok: false, reason: "seat_limit" };
    }

    const found = await findOrCreateUser(tx, phone, email);
    if (!found.ok) return found;
    const { userId, created, tempPassword } = found;

    const [member] = await tx<{ id: string; is_active: boolean }[]>`
      SELECT id, is_active FROM tenant_membership WHERE tenant_id = ${tenantId} AND user_id = ${userId}`;
    if (member) {
      if (member.is_active) return { ok: false, reason: "already_member" };
      // عضوِ قبلاً غیرفعال‌شده: بازگشت به تیم، با نقشِ تازه (شاید فرق کند)
      await tx`UPDATE tenant_membership SET is_active = true, role = ${role} WHERE id = ${member.id}`;
    } else {
      await tx`INSERT INTO tenant_membership (tenant_id, user_id, role, is_active) VALUES (${tenantId}, ${userId}, ${role}, true)`;
    }

    // اعلان: کاربرِ تازه رمزِ یک‌بارمصرف می‌گیرد؛ کاربرِ قدیمی فقط خبرِ دسترسیِ تازه.
    const payload = created
      ? { type: "team_invite", tenantName: tenant.name, identifier: phone, tempPassword }
      : { type: "team_invite", tenantName: tenant.name, identifier: phone, tempPassword: "— با رمزِ فعلیِ خود وارد شوید —" };
    await tx`
      INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
      VALUES (${tenantId}, 'sms', ${phone}, ${JSON.stringify(payload)}::jsonb)`;
    if (email)
      await tx`
        INSERT INTO notification_outbox (tenant_id, channel, recipient, payload)
        VALUES (${tenantId}, 'email', ${email}, ${JSON.stringify(payload)}::jsonb)`;

    return { ok: true, created, tempPassword };
  });
}

export type SetMemberResult = { ok: true } | { ok: false; reason: "last_admin" };

/**
 * تغییرِ نقش/فعال‌بودنِ عضوِ تیم. گاردِ «حداقل یک adminِ فعال»: وگرنه کارخانه
 * می‌تواند تصادفاً خودش را از مدیریتِ تیم/نمایندگی/انبار قفل کند.
 */
export async function setTeamMember(params: {
  tenantId: string; membershipId: string; role?: Role; isActive?: boolean;
}): Promise<SetMemberResult> {
  const { tenantId, membershipId } = params;
  return withTenant(tenantId, async (tx) => {
    const willDemoteOrDeactivate = params.isActive === false || params.role === "staff";
    if (willDemoteOrDeactivate) {
      const [target] = await tx<{ role: Role }[]>`
        SELECT role FROM tenant_membership WHERE id = ${membershipId} AND tenant_id = ${tenantId}`;
      if (target?.role === "admin") {
        const [{ n }] = await tx<{ n: number }[]>`
          SELECT count(*)::int AS n FROM tenant_membership
          WHERE tenant_id = ${tenantId} AND role = 'admin' AND is_active AND id <> ${membershipId}`;
        if (n === 0) return { ok: false, reason: "last_admin" };
      }
    }
    await tx`
      UPDATE tenant_membership SET
        role = COALESCE(${params.role ?? null}, role),
        is_active = COALESCE(${params.isActive ?? null}, is_active)
      WHERE id = ${membershipId} AND tenant_id = ${tenantId}`;
    return { ok: true };
  });
}
