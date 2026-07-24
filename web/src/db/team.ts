import { withTenant } from "./client";
import { findOrCreateUser } from "./users";
import { STAFF_PAGE_KEYS } from "@/lib/staffPages";

export type Role = "staff" | "admin";

export type TeamMember = {
  membershipId: string; userId: string; phone: string; email: string | null;
  role: Role; isActive: boolean; canManageAccess: boolean; allowedPages: string[];
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
             tm.role, tm.is_active AS "isActive",
             tm.can_manage_access AS "canManageAccess", tm.allowed_pages AS "allowedPages"
      FROM tenant_membership tm
      JOIN app_user u ON u.id = tm.user_id
      WHERE tm.tenant_id = ${tenantId} AND tm.role IN ('staff','admin')
      ORDER BY tm.is_active DESC, u.phone`,
  );
}

function cleanAllowedPages(pages: string[] | undefined): string[] {
  if (!pages) return [];
  return pages.filter((p) => STAFF_PAGE_KEYS.includes(p));
}

/**
 * دعوتِ عضوِ تیم با موبایل (+ ایمیلِ اختیاری). اگر شماره از قبل در سامانه هست
 * (حتی برای tenantِ دیگر — app_user سراسری است)، رمزِ تازه ساخته نمی‌شود، فقط
 * عضویت اضافه/فعال می‌شود؛ کاربر با همان رمزِ قبلیِ خودش وارد می‌شود.
 * فقط برای کاربرِ **جدید** رمزِ یک‌بارمصرف ساخته و اعلان می‌شود.
 *
 * canManageAccess فقط برای role='admin' معنا دارد؛ allowedPages فقط برای role='staff'
 * (طرفِ دیگر همیشه پیش‌فرض/نادیده گرفته می‌شود، حتی اگر فرم اشتباهی فرستاده باشد).
 */
export async function inviteTeamMember(params: {
  tenantId: string; phone: string; email?: string | null; role: Role;
  canManageAccess?: boolean; allowedPages?: string[];
}): Promise<InviteResult> {
  const { tenantId, phone, role } = params;
  const email = params.email?.trim() || null;
  const canManageAccess = role === "admin" && !!params.canManageAccess;
  const allowedPages = role === "staff" ? cleanAllowedPages(params.allowedPages) : [];

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
      // عضوِ قبلاً غیرفعال‌شده: بازگشت به تیم، با نقش/دسترسیِ تازه (شاید فرق کند)
      await tx`
        UPDATE tenant_membership SET is_active = true, role = ${role},
          can_manage_access = ${canManageAccess}, allowed_pages = ${allowedPages}
        WHERE id = ${member.id}`;
    } else {
      await tx`
        INSERT INTO tenant_membership (tenant_id, user_id, role, is_active, can_manage_access, allowed_pages)
        VALUES (${tenantId}, ${userId}, ${role}, true, ${canManageAccess}, ${allowedPages})`;
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

export type SetMemberResult = { ok: true } | { ok: false; reason: "last_admin" | "last_deputy" };

/**
 * گاردِ مشترکِ setTeamMember/deleteTeamMember: آیا حذف/غیرفعال‌کردن/تنزلِ این
 * عضو، تیم را بدونِ حداقلِ لازم می‌گذارد؟ دو چیز جداگانه باید حفظ شود:
 *   • حداقل یک adminِ فعال — وگرنه هیچ‌کس نمی‌تواند نمایندگی/انبار بسازد.
 *   • حداقل یک «مدیرِ دسترسی»ِ فعال — وگرنه هیچ‌کس نمی‌تواند دسترسیِ بقیه را
 *     دست‌کاری کند و تیم برای همیشه قفل می‌ماند (فقط SQL دستی راه می‌داشت).
 */
async function guardMinimumAccess(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  tenantId: string, membershipId: string,
  willLoseAdmin: boolean, willLoseDeputy: boolean,
): Promise<SetMemberResult | null> {
  const [target] = await tx<{ role: Role; can_manage_access: boolean }[]>`
    SELECT role, can_manage_access FROM tenant_membership WHERE id = ${membershipId} AND tenant_id = ${tenantId}`;
  if (!target) return null;

  if (willLoseAdmin && target.role === "admin") {
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM tenant_membership
      WHERE tenant_id = ${tenantId} AND role = 'admin' AND is_active AND id <> ${membershipId}`;
    if (n === 0) return { ok: false, reason: "last_admin" };
  }
  if (willLoseDeputy && target.role === "admin" && target.can_manage_access) {
    const [{ n }] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM tenant_membership
      WHERE tenant_id = ${tenantId} AND role = 'admin' AND can_manage_access AND is_active AND id <> ${membershipId}`;
    if (n === 0) return { ok: false, reason: "last_deputy" };
  }
  return null;
}

/**
 * تغییرِ نقش/فعال‌بودن/دسترسیِ عضوِ تیم. گاردِ «حداقل یک adminِ فعال» و
 * «حداقل یک مدیرِ دسترسیِ فعال» (guardMinimumAccess).
 */
export async function setTeamMember(params: {
  tenantId: string; membershipId: string; role?: Role; isActive?: boolean;
  canManageAccess?: boolean; allowedPages?: string[];
}): Promise<SetMemberResult> {
  const { tenantId, membershipId } = params;
  return withTenant(tenantId, async (tx) => {
    const willLoseAdmin = params.isActive === false || params.role === "staff";
    const willLoseDeputy = params.isActive === false || params.role === "staff" || params.canManageAccess === false;
    const blocked = await guardMinimumAccess(tx, tenantId, membershipId, willLoseAdmin, willLoseDeputy);
    if (blocked) return blocked;

    if (params.allowedPages !== undefined)
      await tx`UPDATE tenant_membership SET allowed_pages = ${cleanAllowedPages(params.allowedPages)} WHERE id = ${membershipId} AND tenant_id = ${tenantId}`;
    await tx`
      UPDATE tenant_membership SET
        role = COALESCE(${params.role ?? null}, role),
        is_active = COALESCE(${params.isActive ?? null}, is_active),
        can_manage_access = COALESCE(${params.canManageAccess ?? null}, can_manage_access)
      WHERE id = ${membershipId} AND tenant_id = ${tenantId}`;
    return { ok: true };
  });
}

export type DeleteMemberResult = { ok: true } | { ok: false; reason: "last_admin" | "last_deputy" | "linked_to_agent" };

/** حذفِ واقعیِ عضویت (نه فقط غیرفعال‌کردن). app_user سراسری دست‌نخورده می‌ماند. */
export async function deleteTeamMember(params: { tenantId: string; membershipId: string }): Promise<DeleteMemberResult> {
  const { tenantId, membershipId } = params;
  return withTenant(tenantId, async (tx) => {
    const blocked = await guardMinimumAccess(tx, tenantId, membershipId, true, true);
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
