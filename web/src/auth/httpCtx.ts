import { NextResponse } from "next/server";
import { currentUserId } from "./session";
import {
  authorizeAgent, authorizeStaff, authorizeStaffPage, authorizeAdmin, authorizeAccessManager,
  AuthzError, type AgentContext,
} from "./authz";

/**
 * الگوی «userId از نشست → اعتبارسنجیِ tenantId → authorize → نگاشتِ AuthzError به ۴۰۳»
 * قبلاً ۱۴ بار مستقل در route.tsهای مختلف نوشته شده بود، با drift واقعی (بعضی
 * tenantId را unknown می‌گرفتند و خودشان type-check می‌کردند، بعضی رویِ caller
 * حساب می‌کردند؛ بعضی کلیدِ خطا `err` بود بعضی `error`). این فایل همان الگو را
 * یک‌بار پیاده می‌کند؛ همه‌ی نسخه‌ها `{ err: NextResponse }` روی شکست برمی‌گردانند.
 */
type Err = { err: NextResponse };

const unauthenticated = (): Err => ({ err: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) });
const invalidTenant = (): Err => ({ err: NextResponse.json({ error: "invalid" }, { status: 400 }) });
const forbidden = (): Err => ({ err: NextResponse.json({ error: "forbidden" }, { status: 403 }) });

async function ctx<T extends object>(
  tenantId: unknown,
  authorize: (userId: string, tenantId: string) => Promise<T>,
): Promise<Err | (T & { tenantId: string; userId: string })> {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();
  if (typeof tenantId !== "string") return invalidTenant();
  try {
    const r = await authorize(userId, tenantId);
    return { ...r, tenantId, userId };
  } catch (e) {
    if (e instanceof AuthzError) return forbidden();
    throw e;
  }
}

/** نقشِ staff یا admin، بدونِ محدودیتِ صفحه‌ی ریزدانه. */
export const staffCtx = (tenantId: unknown) => ctx(tenantId, authorizeStaff);

/** نقشِ staff/admin، محدود به یک صفحه‌ی مشخص (`allowed_pages`). */
export const staffPageCtx = (tenantId: unknown, pageKey: string) =>
  ctx(tenantId, (u, t) => authorizeStaffPage(u, t, pageKey));

/** فقط نقشِ admin (مدیریتِ نمایندگی/انبار). */
export const adminCtx = (tenantId: unknown) => ctx(tenantId, authorizeAdmin);

/** admin + `can_manage_access` (مدیریتِ تیم). */
export const accessManagerCtx = (tenantId: unknown) => ctx(tenantId, authorizeAccessManager);

/** نماینده‌ای که به همین tenant/agentAccount وصل است. */
export async function agentCtx(tenantId: unknown, agentAccountId: unknown): Promise<Err | AgentContext> {
  const userId = await currentUserId();
  if (!userId) return unauthenticated();
  if (typeof tenantId !== "string" || typeof agentAccountId !== "string") return invalidTenant();
  try {
    return await authorizeAgent(userId, tenantId, agentAccountId);
  } catch (e) {
    if (e instanceof AuthzError) return forbidden();
    throw e;
  }
}
