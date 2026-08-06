"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../../Icon";
import MessageBanner from "../../MessageBanner";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";
import { formatMoney } from "@/lib/money";

type Agent = { id: string; name: string; limit: number | null };
type Settings = { tenantLimit: number | null; agents: Agent[] };

/** ورودی خالی → null (خاموش/ارث). عددِ نامعتبر → undefined یعنی «ذخیره نکن». */
const parseLimit = (s: string): number | null | undefined => {
  const t = s.replace(/[،,\s]/g, "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  if (t === "") return null;
  const v = Number(t);
  return Number.isSafeInteger(v) && v >= 0 ? v : undefined;
};

export default function AutoApproveSection({ ctx }: { ctx: Ctx }) {
  const [s, setS] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loadErr, setLoadErr] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async (tenantId: string) => {
    const res = await getJson<Settings>(`/api/settings/auto-approve?tenantId=${tenantId}`);
    if (res.ok) {
      setS(res.data);
      setLoadErr("");
      setDraft({
        tenant: res.data.tenantLimit === null ? "" : String(res.data.tenantLimit),
        ...Object.fromEntries(res.data.agents.map((a) => [a.id, a.limit === null ? "" : String(a.limit)])),
      });
    } else setLoadErr(loadError(res.status));
  }, []);

  useEffect(() => { load(ctx.tenantId); }, [ctx.tenantId, load]);

  async function save(scope: "tenant" | "agent", key: string, agentAccountId?: string) {
    const limit = parseLimit(draft[key] ?? "");
    if (limit === undefined) { setSaved("مقدار نامعتبر است."); return; }
    const res = await postJson("/api/settings/auto-approve", { tenantId: ctx.tenantId, scope, agentAccountId, limit }, "PUT");
    setSaved(res.ok ? "ذخیره شد." : actionError(res.status));
    if (res.ok) await load(ctx.tenantId);
  }

  return (
    <>
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          سفارشی که ارزشش <strong>زیر سقف</strong> باشد بدون تأیید پشتیبان قطعی می‌شود؛
          بالای سقف مثل قبل به صف تأیید می‌آید. سقف را <strong>خالی</strong> بگذارید تا خاموش شود.
          اگر قیمتِ کالایی ثبت نشده باشد، آن سفارش هرگز خودکار تأیید نمی‌شود.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      <MessageBanner msg={saved} />

      {s && !loadErr && (
        <>
          <h2>سقف پیش‌فرض کارخانه</h2>
          <div className="card">
            <label htmlFor="tenant-limit">سقف (ریال) — خالی یعنی خاموش</label>
            <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start" }}>
              <input id="tenant-limit" inputMode="numeric" value={draft.tenant ?? ""}
                onChange={(e) => setDraft({ ...draft, tenant: e.target.value })}
                style={{ maxWidth: 220 }} />
              <button onClick={() => save("tenant", "tenant")}>ذخیره</button>
            </div>
            <div className="muted num">
              {s.tenantLimit === null ? "اکنون: خاموش — همه‌ی سفارش‌ها دستی تأیید می‌شوند."
                : `اکنون: سفارش تا ${formatMoney(s.tenantLimit, ctx.currencyUnit)} خودکار تأیید می‌شود.`}
            </div>
          </div>

          <h2>سقف اختصاصی نمایندگان</h2>
          <p className="muted">
            خالی = همان سقفِ کارخانه. عددِ <strong>۰</strong> = این نماینده هرگز خودکار تأیید نشود.
          </p>
          {s.agents.length === 0
            ? <p className="muted">نماینده‌ی فعالی ثبت نشده.</p>
            : s.agents.map((a) => (
                <div className="card" key={a.id}>
                  <div className="row"><strong>{a.name}</strong></div>
                  <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start" }}>
                    <input inputMode="numeric" aria-label={`سقف ${a.name}`} value={draft[a.id] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [a.id]: e.target.value })}
                      style={{ maxWidth: 220 }} />
                    <button onClick={() => save("agent", a.id, a.id)}>ذخیره</button>
                  </div>
                  <div className="muted num">
                    {a.limit === null
                      ? (s.tenantLimit === null ? "ارث از کارخانه: خاموش" : `ارث از کارخانه: ${formatMoney(s.tenantLimit, ctx.currencyUnit)}`)
                      : a.limit === 0 ? "هرگز خودکار تأیید نمی‌شود"
                      : `سقف اختصاصی: ${formatMoney(a.limit, ctx.currencyUnit)}`}
                  </div>
                </div>
              ))}
        </>
      )}
    </>
  );
}
