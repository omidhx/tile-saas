import { NextResponse } from "next/server";
import { currentUserId } from "./session";
import {
  authorizeAgent, authorizeStaff, authorizeStaffPage, authorizeAdmin, authorizeAccessManager,
  AuthzError, type AgentContext,
} from "./authz";
import { checkRateAsync } from "./rateLimit";

/**
 * الگوی «userId از نشست → rate limit → اعتبارسنجیِ tenantId → authorize → نگاشتِ AuthzError به ۴۰۳»
 *
 * rate limit در اینجا اضافه شده تا همه‌ی routeهایی که از *Ctx استفاده می‌کنند
 * به‌طور خودکار rate limit داشته باشند. این الگو AUD-007 را حل می‌کند:
 *
 * Policy سه‌سطحی:
 *   - مسیرهای auth (login, password, reset): fail-closed، سقف‌های خاص خودشان
 *   - مسیرهای tenant-scoped (staff/agent/admin): fail-open، ۶۰/min per user
 *   - مسیرهای platformAdmin: fail-open، ۲۰/min per user
 *
 * مسیرهای auth مستقیماً checkRateAsync را در route خود صدا می‌زنند (نه از اینجا)
 * چون سقف‌های متفاوتی دارند و قبل از currentUserId هم اجرا می‌شوند (برای
 * per-IP rate limit).
 */
type Err = { err: NextResponse };

const unauthenticated = (): Err => ({ err: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) });
const invalidTenant = (): Err => ({ err: NextResponse.json({ error: "invalid" }, { status: 400 }) });
const forbidden = (): Err => ({ err: NextResponse.json({ error: "forbidden" }, { status: 403 }) });

// ──────────────────────────────────────────────────────────
// Rate limit policy برای tenant-scoped routes
// ──────────────────────────────────────────────────────────
// ۶۰ mutation در دقیقه per user — برای staff/admin کافی است.
// fail-open: اگر DB در دسترس نباشد، درخواست رد نمی‌شود (در دسترس بودن > rate limit).
const TENANT_RATE_LIMIT = 60;
const TENANT_RATE_WINDOW = 60_000;

// PlatformAdmin کمی محدودتر — کمتر از staff معمولی کار می‌کند.
const PLATFORM_RATE_LIMIT = 20;
const PLATFORM_RATE_WINDOW = 60_000;

async function ctx<T extends object>(
  tenantId: unknown,
  authorize: (userId: string, tenantId: string) => Promise<T>,
  rateLimitKey?: (userId: string) => string,
): Promise<Err | (T & { tenantId: string; userId: string })> {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();
  if (typeof tenantId !== "string") return invalidTenant();

  // Rate limit — اگر key تابع داده شد، از آن استفاده کن
  if (rateLimitKey) {
    const rl = await checkRateAsync(
      rateLimitKey(userId), TENANT_RATE_LIMIT, TENANT_RATE_WINDOW,
      { failPolicy: "open" },
    );
    if (!rl.ok) return { err: NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } }) };
  }

  try {
    const r = await authorize(userId, tenantId);
    return { ...r, tenantId, userId };
  } catch (e) {
    if (e instanceof AuthzError) return forbidden();
    throw e;
  }
}

/** نقشِ staff یا admin، بدونِ محدودیتِ صفحه‌ی ریزدانه. */
export const staffCtx = (tenantId: unknown) =>
  ctx(tenantId, authorizeStaff, (uid) => `staff:${uid}`);

/** نقشِ staff/admin، محدود به یک صفحه‌ی مشخص (`allowed_pages`). */
export const staffPageCtx = (tenantId: unknown, pageKey: string) =>
  ctx(tenantId, (u, t) => authorizeStaffPage(u, t, pageKey), (uid) => `staff:${uid}`);

/** فقط نقشِ admin (مدیریتِ نمایندگی/انبار). */
export const adminCtx = (tenantId: unknown) =>
  ctx(tenantId, authorizeAdmin, (uid) => `admin:${uid}`);

/** admin + `can_manage_access` (مدیریتِ تیم). */
export const accessManagerCtx = (tenantId: unknown) =>
  ctx(tenantId, authorizeAccessManager, (uid) => `access:${uid}`);

/** نماینده‌ای که به همین tenant/agentAccount وصل است. */
export async function agentCtx(tenantId: unknown, agentAccountId: unknown): Promise<Err | AgentContext> {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();
  if (typeof tenantId !== "string" || typeof agentAccountId !== "string") return invalidTenant();

  // Rate limit برای agent — ۶۰/min
  const rl = await checkRateAsync(
    `agent:${userId}`, TENANT_RATE_LIMIT, TENANT_RATE_WINDOW,
    { failPolicy: "open" },
  );
  if (!rl.ok) return { err: NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } }) };

  try {
    return await authorizeAgent(userId, tenantId, agentAccountId);
  } catch (e) {
    if (e instanceof AuthzError) return forbidden();
    throw e;
  }
}

/** PlatformAdmin — کمتر از staff، چون کمتر کار می‌کند. */
export async function platformAdminCtx(): Promise<Err | { userId: string }> {
  const { authorizePlatformAdmin } = await import("./authz");
  const userId = await currentUserId();
  if (!userId) return unauthenticated();

  // Rate limit برای platformAdmin — ۲۰/min
  const rl = await checkRateAsync(
    `platform:${userId}`, PLATFORM_RATE_LIMIT, PLATFORM_RATE_WINDOW,
    { failPolicy: "open" },
  );
  if (!rl.ok) return { err: NextResponse.json({ error: "too_many_requests" }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } }) };

  try {
    return await authorizePlatformAdmin(userId);
  } catch (e) {
    if (e instanceof AuthzError) return forbidden();
    throw e;
  }
}
