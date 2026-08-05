import Icon from "../Icon";
import { remainingTime } from "@/lib/date";

const num = (v: number) => v.toLocaleString("fa-IR");
const numUnit = (v: number) => v.toLocaleString("fa-IR", { maximumFractionDigits: 2 });

export type ResvItem = {
  name: string; code: string; quantityBoxes: number;
  boxesPerPallet: number | null; sqcmPerBox: number | null;
};
export type Resv = {
  id: string; status: string; expiresAt: string; agentName: string;
  assignedStaffName: string | null; assignedStaffPhone: string | null; items: ResvItem[];
};
export type Req = {
  id: string; status: string; agentName: string; approvalMode: "manual" | "auto";
  assignedStaffName: string | null; assignedStaffPhone: string | null;
  items: { name: string; code: string; qty: number }[];
};

/**
 * صفِ کار: «رزروهای در انتظار تأیید» + «درخواست‌های تأییدشده». صرفاً presentational
 * است — همه‌ی state/دیتافچ در staff/page.tsx می‌ماند، این‌جا فقط JSXِ تکراری از
 * فایلِ اصلی جدا شده (خوانایی، نه تغییرِ رفتار).
 */
export default function QueueSection({
  pendingResvs, reqs, highlightResv, highlightReq, pending,
  onApprove, onCancel, onMakeDispatch, loaded, loadErr,
}: {
  pendingResvs: Resv[]; reqs: Req[];
  highlightResv: Set<string>; highlightReq: Set<string>;
  pending: string | null;
  onApprove: (id: string) => void; onCancel: (id: string) => void; onMakeDispatch: (id: string) => void;
  loaded: boolean; loadErr: string;
}) {
  return (
    <>
      {/* صفِ کار: چیزی که پشتیبان برای آن وارد شده، پس اول می‌آید و شمارشش
          روی تیتر است تا بدون اسکرول معلوم باشد چقدر کار مانده. */}
      <h2>
        رزروهای در انتظار تأیید
        {pendingResvs.length > 0 && <span className="badge badge--warn">{num(pendingResvs.length)}</span>}
      </h2>
      {loaded && !loadErr && pendingResvs.length === 0 && <p className="empty">رزروِ فعالی برای تأیید نیست.</p>}
      {pendingResvs.map((r) => {
        // مهلتِ باقی‌مانده تا انقضا — صف حالا با همین ترتیب دارد (زودترین انقضا اول)،
        // پس دیدنِ خودِ عدد هم لازم است، وگرنه ترتیب بی‌توضیح می‌ماند.
        const rem = remainingTime(r.expiresAt);
        return (
        <div className={highlightResv.has(r.id) ? "card card--new" : "card"} key={r.id}>
          <div className="row">
            <strong>{r.agentName}</strong>
            <span className="row row--start" style={{ gap: "var(--sp-2)" }}>
              {highlightResv.has(r.id) && <span className="badge badge--warn">تازه</span>}
              {/* پشتیبانِ ثابت: پورسانتِ این سفارش دستِ کیست — هر staffی که صف را می‌بیند باید بداند */}
              {(r.assignedStaffName || r.assignedStaffPhone) && (
                <span className="subtle">پشتیبان: {r.assignedStaffName ?? r.assignedStaffPhone}</span>
              )}
              <span className={rem.low ? "err" : "subtle"} style={{ display: "inline-flex", gap: ".3em", alignItems: "center" }}>
                <Icon name="clock" size={13} />{rem.text}{!rem.low ? " مانده" : ""}
              </span>
            </span>
          </div>
          <div className="muted">
            {/* معادلِ پالت/مترمربع کنارِ هر قلم — سنجشِ سریعِ سفارش‌های بزرگ بدونِ محاسبه‌ی ذهنی */}
            {r.items.map((i, idx) => (
              <span key={idx}>
                {idx > 0 && "، "}
                {i.name} ×{num(i.quantityBoxes)}
                {(i.boxesPerPallet || i.sqcmPerBox) && (
                  <span className="subtle">
                    {" ("}
                    {i.boxesPerPallet && `${numUnit(i.quantityBoxes / i.boxesPerPallet)} پالت`}
                    {i.boxesPerPallet && i.sqcmPerBox && "، "}
                    {i.sqcmPerBox && `${numUnit((i.quantityBoxes * i.sqcmPerBox) / 10000)} مترمربع`}
                    {")"}
                  </span>
                )}
              </span>
            ))}
          </div>
          <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
            <button className="primary" onClick={() => onApprove(r.id)}
              disabled={pending === "approve" + r.id} aria-busy={pending === "approve" + r.id}>
              {pending === "approve" + r.id && <span className="spinner" aria-hidden="true" />}تأیید
            </button>
            <button className="ghost" onClick={() => onCancel(r.id)}
              disabled={pending === "cancel" + r.id} aria-busy={pending === "cancel" + r.id}>
              {pending === "cancel" + r.id && <span className="spinner" aria-hidden="true" />}لغو
            </button>
          </div>
        </div>
        );
      })}

      <h2>
        درخواست‌های تأییدشده
        {reqs.length > 0 && <span className="badge">{num(reqs.length)}</span>}
      </h2>
      {loaded && !loadErr && reqs.length === 0 && <p className="empty">درخواست تأییدشده‌ای برای حواله نیست.</p>}
      {reqs.map((r) => (
        <div className={highlightReq.has(r.id) ? "card card--new" : "card"} key={r.id}>
          <div className="row">
            <strong>{r.agentName}</strong>
            <span className="row row--start" style={{ gap: "var(--sp-2)" }}>
              {highlightReq.has(r.id) && <span className="badge badge--warn">تازه</span>}
              {(r.assignedStaffName || r.assignedStaffPhone) && (
                <span className="subtle">پشتیبان: {r.assignedStaffName ?? r.assignedStaffPhone}</span>
              )}
              {/* پشتیبان باید ببیند کدام سفارش بدونِ او تأیید شده — وگرنه فیچر بی‌سروصدا کار می‌کند */}
              {r.approvalMode === "auto" && <span className="badge badge--ok">تأیید خودکار (زیر سقف)</span>}
            </span>
          </div>
          <div className="muted">{r.items.map((i) => `${i.name} ×${num(i.qty)}`).join("، ")}</div>
          <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
            <button onClick={() => onMakeDispatch(r.id)} disabled={pending === r.id} aria-busy={pending === r.id}>
              {pending === r.id && <span className="spinner" aria-hidden="true" />}ساخت حواله
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
