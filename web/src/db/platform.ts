import { sql } from "./client";
import { findOrCreateUser } from "./users";

/**
 * روزِ صفرِ یک مشتریِ تازه‌ی SaaS (v9): ساختِ tenant + اولین کاربرِ admin.
 *
 * چرا `sql.begin` مستقیم، نه `withTenant`: tenant هنوز وجود ندارد، پس نمی‌شود
 * از قبل tenantId را به RLS داد. اول tenant را همین‌جا می‌سازیم، بعد در همان
 * تراکنش `app.tenant_id` را ست می‌کنیم — اگر بعدش (مثلاً ایمیلِ تکراری در
 * findOrCreateUser) شکست بخوریم، کل تراکنش (از جمله خودِ tenant) رول‌بک
 * می‌شود؛ وگرنه یک tenantِ یتیمِ بدونِ هیچ عضوی می‌ماند.
 *
 * 🔴 نکته‌ای که تست گرفت: `sql.begin` فقط با **throw** رول‌بک می‌کند، نه با
 * `return`ِ معمولی — یک return زودهنگام از داخلِ callback یعنی «موفقیت»، پس
 * COMMIT می‌شود. برای همین شکست‌های میان‌راه (بعدِ ساختِ tenant) را throw
 * می‌کنیم و بیرونِ تراکنش catch می‌کنیم، نه اینکه مستقیم return کنیم.
 */
export type CreateTenantResult =
  | { ok: true; tenantId: string; tempPassword: string | null }
  | { ok: false; reason: "invalid" | "slug_taken" | "email_taken" };

class CreateTenantRejected extends Error {
  constructor(public reason: "slug_taken" | "email_taken") { super(reason); }
}

export async function createTenant(p: {
  name: string; slug: string;
  adminPhone: string; adminEmail?: string | null; adminFullName?: string | null;
}): Promise<CreateTenantResult> {
  const name = p.name.trim(), slug = p.slug.trim(), adminPhone = p.adminPhone.trim();
  if (!name || !slug || !adminPhone) return { ok: false, reason: "invalid" };

  try {
    const { tenantId, tempPassword } = await sql.begin(async (tx) => {
      const [dupSlug] = await tx`SELECT 1 FROM tenant WHERE slug = ${slug}`;
      if (dupSlug) throw new CreateTenantRejected("slug_taken");

      const [t] = await tx<{ id: string }[]>`
        INSERT INTO tenant (name, slug) VALUES (${name}, ${slug}) RETURNING id`;

      // از این‌جا به بعد جدولِ RLS‌دار (tenant_membership) لمس می‌شود.
      await tx`SELECT set_config('app.tenant_id', ${t.id}, true)`;

      const found = await findOrCreateUser(
        tx, adminPhone, p.adminEmail?.trim() || null, p.adminFullName?.trim() || null);
      if (!found.ok) throw new CreateTenantRejected(found.reason);

      // اولین مدیرِ یک کارخانه‌ی تازه همیشه «مدیرِ دسترسی» هم هست — وگرنه هیچ‌کس
      // در آن کارخانه نمی‌تواند دسترسیِ بقیه را تنظیم کند (بن‌بستِ v4).
      await tx`
        INSERT INTO tenant_membership (tenant_id, user_id, role, is_active, can_manage_access)
        VALUES (${t.id}, ${found.userId}, 'admin', true, true)`;

      return { tenantId: t.id, tempPassword: found.tempPassword };
    }) as { tenantId: string; tempPassword: string | null };
    return { ok: true, tenantId, tempPassword };
  } catch (e) {
    if (e instanceof CreateTenantRejected) return { ok: false, reason: e.reason };
    throw e;
  }
}
