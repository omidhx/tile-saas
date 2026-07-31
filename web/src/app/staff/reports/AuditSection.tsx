"use client";
import { getJson } from "@/lib/api";
import { usePaginatedSearch } from "@/lib/usePaginatedSearch";
import Icon from "../../Icon";
import type { Ctx } from "@/lib/useContexts";
import { formatJalaliDateTime } from "@/lib/date";

type FieldDiff = Record<string, string | number | boolean | null>;
type Entry = {
  id: string; action: string; entity: string; entityId: string | null;
  oldValue: number | FieldDiff | null; newValue: number | FieldDiff | null; createdAt: string;
  actorPhone: string | null; label: string | null;
};

const n = (v: number) => v.toLocaleString("fa-IR");

const ACTION_FA: Record<string, string> = {
  "price.set": "تغییر قیمت",
  "auto_approve_limit.tenant": "سقف تأیید خودکار — کارخانه",
  "auto_approve_limit.agent": "سقف تأیید خودکار — نمایندگی",
  "product.edit": "ویرایشِ محصول",
  "customer.edit": "ویرایشِ مشتری",
};

const FIELD_FA: Record<string, string> = {
  name: "نام", color: "رنگ", glaze: "لعاب", punch: "پانچ", body: "بدنه",
  size: "ابعاد", thickness: "ضخامت", usageArea: "کاربری", description: "توضیحات",
  boxesPerPallet: "کارتن در پالت", sqcmPerBox: "متراژِ کارتن",
  phone: "شماره تماس", note: "یادداشت", isActive: "فعال",
};

const fieldVal = (v: string | number | boolean | null) =>
  v === null ? "—" : typeof v === "boolean" ? (v ? "بله" : "خیر") : String(v);

/** مقدارِ پولی، با «تعریف‌نشده» به‌جای عددِ خالی — چون NULL معنیِ خودش را دارد. */
function money(v: number | null, action: string) {
  if (v === null) return action.startsWith("auto_approve_limit") ? "خاموش/ارث" : "بدون قیمت";
  if (v === 0 && action.startsWith("auto_approve_limit")) return "هرگز خودکار";
  return `${n(v)} ریال`;
}

const fetchEntries = (tenantId: string, query: string, offset: number) =>
  getJson<{ entries: Entry[]; hasMore: boolean }>(
    `/api/audit?tenantId=${tenantId}&offset=${offset}${query ? `&q=${encodeURIComponent(query)}` : ""}`);

export default function AuditSection({ ctx, onLedger }: { ctx: Ctx; onLedger: () => void }) {
  const { rows, q, hasMore, moreBusy, loadErr, loaded, search, loadMore } =
    usePaginatedSearch(ctx.tenantId, fetchEntries, (raw) => raw.entries);

  return (
    <>
      {/* دامنه‌ی محدودِ این دفتر باید صریح گفته شود، وگرنه کاربر فکر می‌کند
          «همه‌چیز» اینجاست و جای اشتباه دنبالِ ردپا می‌گردد. */}
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          این‌جا تغییرِ <strong>قواعدِ پولی</strong> (قیمت، سقفِ تأیید خودکار) و ویرایشِ <strong>محصول/مشتری</strong> ثبت می‌شود.
          حرکتِ موجودی در{" "}
          <button type="button" className="link-plain" onClick={onLedger} style={{ textDecoration: "underline" }}>
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

      <input type="search" aria-label="جستجوی دفترِ تغییرات" placeholder="جستجو: کالا، نمایندگی، شماره‌ی عامل…"
        value={q} onChange={(e) => search(e.target.value)} style={{ marginBottom: "var(--sp-3)" }} />
      {loaded && !loadErr && rows.length === 0 && (
        <p className="empty">{q ? "چیزی پیدا نشد." : "هنوز تغییری ثبت نشده."}</p>
      )}

      {rows.map((r) => {
        const isDiff = typeof r.oldValue === "object" && r.oldValue !== null
          || typeof r.newValue === "object" && r.newValue !== null;
        // بالا رفتنِ سقف/پایین آمدنِ قیمت، جهتی است که معمولاً سؤال می‌سازد
        const rose = !isDiff && r.oldValue !== null && r.newValue !== null
          && (r.newValue as number) > (r.oldValue as number);
        return (
          <div className="card" key={r.id}>
            <div className="row">
              <strong>{ACTION_FA[r.action] ?? r.action}</strong>
              <span className="subtle">{formatJalaliDateTime(r.createdAt)}</span>
            </div>
            <div className="muted">{r.label ?? r.entityId ?? "—"}</div>
            {isDiff ? (
              <div style={{ marginTop: "var(--sp-2)" }}>
                {Object.keys((r.newValue as FieldDiff) ?? {}).map((key) => (
                  <div className="row row--start" key={key} style={{ gap: "var(--sp-2)" }}>
                    <span className="subtle">{FIELD_FA[key] ?? key}:</span>
                    <span className="badge">{fieldVal((r.oldValue as FieldDiff)?.[key] ?? null)}</span>
                    <span className="subtle" aria-label="تبدیل شد به">←</span>
                    <span className="badge badge--ok">{fieldVal((r.newValue as FieldDiff)?.[key] ?? null)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="row row--start" style={{ marginTop: "var(--sp-2)", gap: "var(--sp-2)" }}>
                <span className="badge">{money(r.oldValue as number | null, r.action)}</span>
                <span className="subtle" aria-label="تبدیل شد به">←</span>
                <span className={`badge ${rose ? "badge--warn" : "badge--ok"}`}>
                  {money(r.newValue as number | null, r.action)}
                </span>
              </div>
            )}
            <div className="subtle" style={{ marginTop: "var(--sp-2)" }}>
              توسط {r.actorPhone ?? "نامشخص"}
            </div>
          </div>
        );
      })}
      {hasMore && (
        <button onClick={loadMore} aria-busy={moreBusy} disabled={moreBusy} style={{ width: "100%" }}>
          {moreBusy && <span className="spinner" aria-hidden="true" />}بیشتر
        </button>
      )}
    </>
  );
}
