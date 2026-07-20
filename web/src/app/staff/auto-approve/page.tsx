"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getJson, loadError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";

type Agent = { id: string; name: string; limit: number | null };
type Settings = { tenantLimit: number | null; agents: Agent[] };

const n = (v: number) => v.toLocaleString("fa-IR");
/** ورودی خالی → null (خاموش/ارث). عددِ نامعتبر → undefined یعنی «ذخیره نکن». */
const parseLimit = (s: string): number | null | undefined => {
  const t = s.replace(/[،,\s]/g, "").replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
  if (t === "") return null;
  const v = Number(t);
  return Number.isSafeInteger(v) && v >= 0 ? v : undefined;
};

export default function AutoApprovePage() {
  const { ctx, state } = useContexts("staff");
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

  useEffect(() => { if (ctx) load(ctx.tenantId); }, [ctx, load]);

  async function save(scope: "tenant" | "agent", key: string, agentAccountId?: string) {
    if (!ctx) return;
    const limit = parseLimit(draft[key] ?? "");
    if (limit === undefined) { setSaved("مقدار نامعتبر است."); return; }
    const res = await fetch("/api/settings/auto-approve", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: ctx.tenantId, scope, agentAccountId, limit }),
    });
    setSaved(res.ok ? "ذخیره شد." : "ذخیره نشد.");
    if (res.ok) await load(ctx.tenantId);
  }

  if (state === "none") return <main><p className="err" role="alert">این بخش فقط برای پشتیبان است.</p></main>;
  if (!ctx) return <main><p className="muted">در حال بارگذاری…</p></main>;

  return (
    <main>
      <div className="row"><h1>تأیید خودکار سفارش</h1><Link href="/staff" className="muted">← پنل</Link></div>
      <p className="muted">{ctx.tenantName}</p>

      <div className="card">
        <p style={{ margin: 0 }}>
          سفارشی که ارزشش <strong>زیر سقف</strong> باشد بدون تأیید پشتیبان قطعی می‌شود.
          سفارشِ بالای سقف مثل قبل به صف تأیید می‌آید.
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          سقف را خالی بگذارید تا خاموش شود (همه‌چیز دستی تأیید می‌شود).
          اگر قیمتِ کالایی ثبت نشده باشد، آن سفارش هرگز خودکار تأیید نمی‌شود.
        </p>
      </div>

      {loadErr && <div className="card" role="alert"><span className="err">⚠️ {loadErr}</span></div>}
      {saved && <div className="card" role="status">{saved}</div>}

      {s && !loadErr && (
        <>
          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>سقف پیش‌فرض کارخانه</h2>
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
                : `اکنون: سفارش تا ${n(s.tenantLimit)} ریال خودکار تأیید می‌شود.`}
            </div>
          </div>

          <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>سقف اختصاصی نمایندگان</h2>
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
                      ? (s.tenantLimit === null ? "ارث از کارخانه: خاموش" : `ارث از کارخانه: ${n(s.tenantLimit)} ریال`)
                      : a.limit === 0 ? "هرگز خودکار تأیید نمی‌شود"
                      : `سقف اختصاصی: ${n(a.limit)} ریال`}
                  </div>
                </div>
              ))}
        </>
      )}
    </main>
  );
}
