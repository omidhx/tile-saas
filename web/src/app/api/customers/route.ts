import { NextResponse } from "next/server";
import { z } from "zod";
import { id, isId, parse } from "@/lib/validate";
import { staffCtx } from "@/auth/httpCtx";
import { listCustomers, addCustomer, updateCustomer, customerSales, customerHistory } from "@/db/customers";

// agentAccountId خالی ("") یعنی «بدونِ نماینده» — فرم گاهی همین را می‌فرستد.
const Add = z.object({
  name: z.string().refine((v) => v.trim() !== ""),
  phone: z.string().nullish(), note: z.string().nullish(),
  agentAccountId: id.or(z.literal("")).nullish(),
});
const Update = z.object({
  id, name: z.string().optional(), phone: z.string().nullish(), note: z.string().nullish(),
  isActive: z.boolean().optional(),
});

const DAY = 24 * 60 * 60 * 1000;

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
  if (customerId) {
    if (!isId(customerId)) return NextResponse.json({ error: "invalid" }, { status: 400 });
    return NextResponse.json({ history: await customerHistory({ tenantId: c.tenantId, customerId }) });
  }

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

  const q = u.searchParams.get("q") ?? undefined;
  // منفی/اعشار به OFFSET/LIMIT نرسد (۵۰۰ از Postgres)
  const offset = Math.max(0, Math.trunc(Number(u.searchParams.get("offset") ?? "0")) || 0);
  // limit صریح برای خروجیِ اکسل (کلِ نتیجه‌ی فیلترشده، نه فقط صفحه‌ی روی صفحه)؛
  // سقفِ ۲۰٬۰۰۰ ضدِ درخواستِ سنگین (همان الگوی /api/ledger).
  const limit = Math.min(Math.max(1, Math.trunc(Number(u.searchParams.get("limit"))) || 50), 20_000);
  const { items: customers, hasMore } = await listCustomers({ tenantId: c.tenantId, q, offset, limit });
  return NextResponse.json({ customers, hasMore });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Add, body);
  if ("err" in p) return p.err;
  const { name, phone, note, agentAccountId } = p.data;

  const newId = await addCustomer({
    tenantId: c.tenantId, name, phone: phone ?? null, note: note ?? null,
    agentAccountId: agentAccountId || null,
  });
  return NextResponse.json({ id: newId }, { status: 201 });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null);
  const c = await staffCtx(body?.tenantId);
  if ("err" in c) return c.err;
  const p = parse(Update, body);
  if ("err" in p) return p.err;
  const d = p.data;

  // phone/note: نبودن=دست‌نزن، null=پاک‌کن
  await updateCustomer({
    tenantId: c.tenantId, id: d.id, actorUserId: c.userId,
    name: d.name, phone: d.phone, note: d.note, isActive: d.isActive,
  });
  return NextResponse.json({ ok: true });
}
