"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../../Icon";
import { getJson, loadError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";
import { formatJalaliDateTime } from "@/lib/date";

type Entry = {
  id: string; action: string; entity: string; entityId: string | null;
  oldValue: number | null; newValue: number | null; createdAt: string;
  actorPhone: string | null; label: string | null;
};

const n = (v: number) => v.toLocaleString("fa-IR");

const ACTION_FA: Record<string, string> = {
  "price.set": "تغییر قیمت",
  "auto_approve_limit.tenant": "سقف تأیید خودکار — کارخانه",
  "auto_approve_limit.agent": "سقف تأیید خودکار — نمایندگی",
};

/** مقدارِ پولی، با «تعریف‌نشده» به‌جای عددِ خالی — چون NULL معنیِ خودش را دارد. */
function money(v: number | null, action: string) {
  if (v === null) return action.startsWith("auto_approve_limit") ? "خاموش/ارث" : "بدون قیمت";
  if (v === 0 && action.startsWith("auto_approve_limit")) return "هرگز خودکار";
  return `${n(v)} ریال`;
}

export default function AuditSection({ ctx, onLedger }: { ctx: Ctx; onLedger: () => void }) {
  const [rows, setRows] = useState<Entry[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (tenantId: string) => {
    const res = await getJson<{ entries: Entry[] }>(`/api/audit?tenantId=${tenantId}`);
    if (res.ok) { setRows(res.data.entries); setLoadErr(""); }
    else setLoadErr(loadError(res.status));
    setLoaded(true);
  }, []);

  useEffect(() => { load(ctx.tenantId); }, [ctx.tenantId, load]);

  return (
    <>
      {/* دامنه‌ی محدودِ این دفتر باید صریح گفته شود، وگرنه کاربر فکر می‌کند
          «همه‌چیز» اینجاست و جای اشتباه دنبالِ ردپا می‌گردد. */}
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          این‌جا فقط تغییرِ <strong>قواعدِ پولی</strong> ثبت می‌شود: قیمت و سقفِ تأیید خودکار.
          حرکتِ موجودی در{" "}
          <button type="button" onClick={onLedger} style={{ all: "unset", cursor: "pointer", textDecoration: "underline" }}>
            دفتر حرکات
          </button>{" "}
          است و دلیلِ تأییدِ هر سفارش روی خودِ سفارش.
        </span>
      </div>

      {loadErr && (
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>{loadErr}</span>
        </div>
      )}

      {loaded && !loadErr && rows.length === 0 && (
        <p className="empty">هنوز تغییری در قیمت یا سقفِ تأیید خودکار ثبت نشده.</p>
      )}

      {rows.map((r) => {
        // بالا رفتنِ سقف/پایین آمدنِ قیمت، جهتی است که معمولاً سؤال می‌سازد
        const rose = r.oldValue !== null && r.newValue !== null && r.newValue > r.oldValue;
        return (
          <div className="card" key={r.id}>
            <div className="row">
              <strong>{ACTION_FA[r.action] ?? r.action}</strong>
              <span className="subtle">{formatJalaliDateTime(r.createdAt)}</span>
            </div>
            <div className="muted">{r.label ?? r.entityId ?? "—"}</div>
            <div className="row row--start" style={{ marginTop: "var(--sp-2)", gap: "var(--sp-2)" }}>
              <span className="badge">{money(r.oldValue, r.action)}</span>
              <span className="subtle" aria-label="تبدیل شد به">←</span>
              <span className={`badge ${rose ? "badge--warn" : "badge--ok"}`}>
                {money(r.newValue, r.action)}
              </span>
            </div>
            <div className="subtle" style={{ marginTop: "var(--sp-2)" }}>
              توسط {r.actorPhone ?? "نامشخص"}
            </div>
          </div>
        );
      })}
    </>
  );
}
