import { NextResponse } from "next/server";
import { currentUserId } from "@/auth/session";
import { authorizeStaffPage, AuthzError } from "@/auth/authz";
import { listCustomers, addCustomer, updateCustomer, customerSales, customerHistory } from "@/db/customers";

const DAY = 24 * 60 * 60 * 1000;

async function staffCtx(tenantId: unknown) {
  const userId = await currentUserId();
  if (!userId) return { err: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  if (typeof tenantId !== "string") return { err: NextResponse.json({ error: "invalid" }, { status: 400 }) };
  try {
    await authorizeStaffPage(userId, tenantId, "customers");
  } catch (e) {
    if (e instanceof AuthzError) return { err: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    throw e;
  }
  return { tenantId };
}

/**
 * GET ?tenantId               → فهرست مشتری‌ها
 * GET ?tenantId&report=1      → پرخریدترین‌ها در بازه
 * GET ?tenantId&customerId=x  → تاریخچه‌ی یک مشتری
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await staffCtx(u.searchParams.get("tenantId"));
  if ("err" in c) return c.err;

  const customerId = u.searchParams.get("customerId");
  if (customerId)
    return NextResponse.json({ history: await customerHistory({ tenantId: c.tenantId, customerId }) });

  if (u.searchParams.get("report") === "1") {
    // تاریخِ نامعتبر → پیش‌فرض، نه NaN که کوئری را بی‌سروصدا خالی کند (مثل /api/reports)
    const parse = (s: string | null, fallback: Date) => {
      const d = s ? new Date(s) : null;
      return d && !Number.isNaN(d.getTime()) ? d : fallback;
    };
    const to = parse(u.searchParams.get("to"), new Date());
    const from = parse(u.searchParams.get("from"), new Date(to.getTime() - 90 * DAY));
    if (from >= to) return NextResponse.json({ error: "bad_range" }, { status: 400 });
    return NextResponse.json({ rows: await customerSales({ tenantId: c.tenantId, from, to }) });
  }

  return NextResponse.json({ customers: await listCustomers({ tenantId: c.tenantId }) });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;

  const { name, phone, note, agentAccountId } = body ?? {};
  if (typeof name !== "string" || !name.trim())
    return NextResponse.json({ error: "invalid" }, { status: 400 });

  const id = await addCustomer({
    tenantId: c.tenantId, name,
    phone: typeof phone === "string" ? phone : null,
    note: typeof note === "string" ? note : null,
    agentAccountId: typeof agentAccountId === "string" && agentAccountId ? agentAccountId : null,
  });
  return NextResponse.json({ id }, { status: 201 });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  if (typeof body?.id !== "string") return NextResponse.json({ error: "invalid" }, { status: 400 });

  await updateCustomer({
    tenantId: c.tenantId, id: body.id,
    name: typeof body.name === "string" ? body.name : undefined,
    phone: body.phone === undefined ? undefined : (typeof body.phone === "string" ? body.phone : null),
    note: body.note === undefined ? undefined : (typeof body.note === "string" ? body.note : null),
    isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
  });
  return NextResponse.json({ ok: true });
}
