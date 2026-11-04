import * as Sentry from "@sentry/nextjs";
import { sql, withTenant } from "@/db/client";

// فقط شناسه — هرگز شماره/ایمیل (مدلِ احرازِ این اپ موبایل‌محور است). بدونِ این،
// خطاهای Sentry هیچ ردی از «کدامین tenant/کاربر» ندارند — دقیقاً همان کلاسِ باگ
// (نشتِ بین‌تنانتی) که این chokepoint برایش ساخته شده، کندتر تشخیص داده می‌شود.
function tagRequest(userId: string, tenantId?: string) {
  Sentry.setUser({ id: userId });
  if (tenantId) Sentry.setTag("tenantId", tenantId);
}

export class AuthzError extends Error {}

export type AgentContext = {
  userId: string;
  tenantId: string;
  agentAccountId: string;
  ttlHours: number;
};

/**
 * chokepoint دسترسی — قانون معماری #۸ (Authorization > Authentication، بزرگ‌ترین ریسک IDOR).
 * هرگز tenant/agent را از کلاینت باور نکن؛ همیشه در برابر DB تأیید کن:
 *   • کاربر عضو فعالِ این tenant هست؟
 *   • کاربر به این agent_account (که مالِ همین tenant است) وصله؟
 *
 * دفاع دولایه (belt & suspenders، مثل composite FK + RLS):
 *   • فیلترِ صریحِ tenant_id در کوئری (کار می‌کنه حتی اگه RLS خاموش/غلط باشه)
 *   • withTenant → RLS هم مستقلاً فیلتر می‌کنه
 * پرتاب AuthzError یعنی ۴۰۳.
 */
export async function authorizeAgent(
  userId: string,
  tenantId: string,
  agentAccountId: string,
): Promise<AgentContext> {
  return withTenant(tenantId, async (tx) => {
    const member = await tx`
      SELECT 1 FROM tenant_membership
      WHERE user_id = ${userId} AND tenant_id = ${tenantId} AND is_active
      LIMIT 1`;
    if (member.length === 0) throw new AuthzError("کاربر عضو این tenant نیست");

    const linked = await tx`
      SELECT 1 FROM agent_account_user
      WHERE user_id = ${userId} AND agent_account_id = ${agentAccountId}
        AND tenant_id = ${tenantId}
      LIMIT 1`;
    if (linked.length === 0) throw new AuthzError("کاربر به این نمایندگی وصل نیست");

    const [t] = await tx<{ ttl: number }[]>`
      SELECT default_reservation_ttl_hours AS ttl FROM tenant WHERE id = ${tenantId}`;
    if (!t) throw new AuthzError("tenant یافت نشد");

    tagRequest(userId, tenantId);
    return { userId, tenantId, agentAccountId, ttlHours: t.ttl };
  });
}

/**
 * دسترسیِ staff — برای تأیید تجاری و ساخت/بارگیریِ حواله (spec ۵.۶: حواله همیشه staff).
 * نیازمند عضویتِ فعال با نقشِ 'staff' یا 'admin'. نماینده (role='agent') رد می‌شه.
 */
export async function authorizeStaff(userId: string, tenantId: string): Promise<{ userId: string; tenantId: string; role: string }> {
  return withTenant(tenantId, async (tx) => {
    const [m] = await tx<{ role: string }[]>`
      SELECT role FROM tenant_membership
      WHERE user_id = ${userId} AND tenant_id = ${tenantId} AND is_active
      LIMIT 1`;
    if (!m) throw new AuthzError("کاربر عضو این tenant نیست");
    if (m.role !== "staff" && m.role !== "admin") throw new AuthzError("این عملیات نیازمند نقشِ staff است");
    tagRequest(userId, tenantId);
    return { userId, tenantId, role: m.role };
  });
}

/**
 * دسترسیِ admin — v3: مدیریتِ تیم/نمایندگی/انبار (ساختِ حساب، تعیینِ دسترسی) از
 * تأییدِ روزمره‌ی staff جداست؛ نقشی که رمز/دسترسیِ بقیه را دست‌کاری می‌کند باید
 * محدودتر از نقشی باشد که فقط سفارش تأیید می‌کند. برخلافِ authorizeStaff، اینجا
 * 'staff' کافی نیست — فقط 'admin'.
 */
export async function authorizeAdmin(userId: string, tenantId: string): Promise<{ userId: string; tenantId: string }> {
  return withTenant(tenantId, async (tx) => {
    const [m] = await tx<{ role: string }[]>`
      SELECT role FROM tenant_membership
      WHERE user_id = ${userId} AND tenant_id = ${tenantId} AND is_active
      LIMIT 1`;
    if (!m) throw new AuthzError("کاربر عضو این tenant نیست");
    if (m.role !== "admin") throw new AuthzError("این عملیات نیازمند نقشِ admin است");
    tagRequest(userId, tenantId);
    return { userId, tenantId };
  });
}

/**
 * دسترسیِ «مدیرِ دسترسی» (v4) — سخت‌گیرتر از authorizeAdmin. admin‌بودن برای
 * مدیریتِ نمایندگی/انبار کافی است، ولی برای دست‌کاریِ تیم (دعوت، نقش، حذف،
 * چک‌لیستِ صفحه‌ها) به فلگِ صریحِ can_manage_access نیاز است — کسی که رمز/
 * دسترسیِ بقیه را تعیین می‌کند باید محدودتر از یک adminِ معمولی باشد.
 */
export async function authorizeAccessManager(userId: string, tenantId: string): Promise<{ userId: string; tenantId: string }> {
  return withTenant(tenantId, async (tx) => {
    const [m] = await tx<{ role: string; can_manage_access: boolean }[]>`
      SELECT role, can_manage_access FROM tenant_membership
      WHERE user_id = ${userId} AND tenant_id = ${tenantId} AND is_active
      LIMIT 1`;
    if (!m) throw new AuthzError("کاربر عضو این tenant نیست");
    if (m.role !== "admin" || !m.can_manage_access) throw new AuthzError("این عملیات نیازمندِ مدیرِ دسترسی است");
    tagRequest(userId, tenantId);
    return { userId, tenantId };
  });
}

/**
 * دسترسیِ «مدیرِ پلتفرم» (v9) — بالاتر از سطحِ tenant، بدونِ withTenant: این
 * چک قبل از وجودِ هر tenantی هم باید کار کند (ساختِ کارخانه‌ی تازه). app_user
 * جدولِ سراسری است (بدونِ tenant_id)، پس RLS رویش تعریف نشده و کوئریِ مستقیم
 * امن است — نه IDOR، چون فقط رویِ خودِ userId (از JWT) چک می‌کند.
 */
export async function authorizePlatformAdmin(userId: string): Promise<{ userId: string }> {
  const [u] = await sql<{ is_platform_admin: boolean }[]>`
    SELECT is_platform_admin FROM app_user WHERE id = ${userId}`;
  if (!u || !u.is_platform_admin) throw new AuthzError("این عملیات نیازمندِ مدیرِ پلتفرم است");
  tagRequest(userId);
  return { userId };
}

/**
 * دسترسیِ staff محدود به یک صفحه‌ی مشخص (v4، «دسترسیِ ریزدانه»). admin از این
 * چک معاف است (همیشه دسترسیِ کامل). برای role='staff': allowed_pages خالی
 * یعنی دسترسیِ کامل (پیش‌فرض/سازگار با قبل)؛ غیرخالی یعنی فقط همان صفحه‌ها.
 */
export async function authorizeStaffPage(
  userId: string, tenantId: string, pageKey: string,
): Promise<{ userId: string; tenantId: string; role: string }> {
  return withTenant(tenantId, async (tx) => {
    const [m] = await tx<{ role: string; allowed_pages: string[] }[]>`
      SELECT role, allowed_pages FROM tenant_membership
      WHERE user_id = ${userId} AND tenant_id = ${tenantId} AND is_active
      LIMIT 1`;
    if (!m) throw new AuthzError("کاربر عضو این tenant نیست");
    if (m.role !== "staff" && m.role !== "admin") throw new AuthzError("این عملیات نیازمند نقشِ staff است");
    if (m.role === "staff" && m.allowed_pages.length > 0 && !m.allowed_pages.includes(pageKey))
      throw new AuthzError("دسترسیِ این بخش برای شما باز نشده است");
    tagRequest(userId, tenantId);
    return { userId, tenantId, role: m.role };
  });
}
