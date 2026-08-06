"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type Ctx = {
  tenantId: string; tenantName: string;
  agentAccountId: string | null; agentLegalName: string | null;
  role: string;
  // v4: فقط برای role='admin'/'staff' معنا دارند (بخشِ «دسترسی» در db/team.ts)
  canManageAccess: boolean; allowedPages: string[];
  // v5: پشتیبانِ ثابتِ این نمایندگی — فقط وقتی agentAccountId پر است معنا دارد
  assignedStaffName: string | null; assignedStaffPhone: string | null;
  // v11: واحدِ نمایشِ مبلغ — فقط لایه‌ی نمایش، ذخیره‌سازی همیشه ریال است (lib/money.ts)
  currencyUnit: "rial" | "toman";
};

// انتخابِ کاربر بین جلسه‌ها می‌ماند. localStorage امن است چون **مرجعِ دسترسی نیست**:
// سرور در هر درخواست با authorizeAgent/authorizeStaff دوباره تأیید می‌کند، پس
// دست‌کاریِ این مقدار فقط ۴۰۳ می‌گیرد، نه دسترسی.
const KEY = "tile.ctx";

type State = "loading" | "ready" | "none";

/**
 * contextهای کاربر + انتخابِ فعال.
 * `kind='agent'` فقط contextهایی که نمایندگی دارند (صفحه‌های نماینده)،
 * `kind='staff'` فقط نقشِ staff/admin (پنل پشتیبان).
 * قبلاً هر صفحه `contexts[0]` را می‌گرفت؛ یعنی کاربری که به دو نمایندگی وصل بود
 * هرگز به دومی دسترسی نداشت و هیچ نشانه‌ای هم نمی‌دید.
 */
export function useContexts(kind: "agent" | "staff") {
  const router = useRouter();
  const [all, setAll] = useState<Ctx[]>([]);
  const [ctx, setCtxState] = useState<Ctx | null>(null);
  const [state, setState] = useState<State>("loading");

  const select = useCallback((c: Ctx) => {
    setCtxState(c);
    try {
      localStorage.setItem(KEY, JSON.stringify({ tenantId: c.tenantId, agentAccountId: c.agentAccountId }));
    } catch { /* حالت خصوصی مرورگر — انتخاب فقط تا پایان همین صفحه می‌ماند */ }
  }, []);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me");
      if (res.status === 401) { router.push("/login"); return; }
      if (!res.ok) { setState("none"); return; }
      const { contexts } = (await res.json()) as { contexts: Ctx[] };
      const usable = (contexts ?? []).filter((c) =>
        kind === "agent" ? !!c.agentAccountId : c.role === "staff" || c.role === "admin");
      setAll(usable);
      if (usable.length === 0) { setState("none"); return; }

      // انتخابِ ذخیره‌شده اگر هنوز معتبر است، وگرنه اولی (مثلاً دسترسی لغو شده)
      let saved: { tenantId?: string; agentAccountId?: string | null } | null = null;
      try { saved = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { saved = null; }
      const match = saved && usable.find(
        (c) => c.tenantId === saved!.tenantId && c.agentAccountId === saved!.agentAccountId);
      setCtxState(match ?? usable[0]);
      setState("ready");
    })();
  }, [router, kind]);

  return { contexts: all, ctx, state, select };
}
