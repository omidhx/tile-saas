import { NextResponse } from "next/server";
import { sql } from "@/db/client";
import { currentUserId } from "@/auth/session";

// context‌های کاربر (tenant/نمایندگی). از user_contexts (SECURITY DEFINER) که
// bootstrapِ cross-tenant را امن از RLS عبور می‌ده. userId از JWT، نه کلاینت.
export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const rows = await sql<
    {
      tenant_id: string; tenant_name: string; agent_account_id: string | null; agent_legal_name: string | null;
      role: string; can_manage_access: boolean; allowed_pages: string[];
      assigned_staff_name: string | null; assigned_staff_phone: string | null;
      currency_unit: string;
    }[]
  >`SELECT * FROM user_contexts(${userId})`;

  // v9: app_user جدولِ سراسری/بدونِ RLS است، پس کوئریِ مستقیم (نه از طریقِ
  // user_contexts) امن است. مدیرِ پلتفرم ممکن است هیچ contextِ tenantی نداشته
  // باشد (حسابِ خالص برای ساختِ کارخانه‌ی تازه)، پس این فلگ جدا از contexts می‌آید.
  const [u] = await sql<{ is_platform_admin: boolean }[]>`
    SELECT is_platform_admin FROM app_user WHERE id = ${userId}`;

  // agentAccountId برای کاربر staff نال است — UI باید هندلش کنه، نه اینکه قفل شه.
  return NextResponse.json({
    isPlatformAdmin: u?.is_platform_admin ?? false,
    contexts: rows.map((r) => ({
      tenantId: r.tenant_id,
      tenantName: r.tenant_name,
      agentAccountId: r.agent_account_id,
      agentLegalName: r.agent_legal_name,
      role: r.role,
      canManageAccess: r.can_manage_access,
      allowedPages: r.allowed_pages,
      // v5: پشتیبانِ ثابتِ همین نمایندگی — فقط برای contextِ agent پر است.
      assignedStaffName: r.assigned_staff_name,
      assignedStaffPhone: r.assigned_staff_phone,
      currencyUnit: r.currency_unit,
    })),
  });
}
