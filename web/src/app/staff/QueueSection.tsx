import { useState } from "react";
import Icon from "../Icon";
import { remainingTime } from "@/lib/date";
import CustomerPicker, { type CustomerOption } from "./CustomerPicker";

const num = (v: number) => v.toLocaleString("fa-IR");
const numUnit = (v: number) => v.toLocaleString("fa-IR", { maximumFractionDigits: 2 });

export type DispatchExtra = { destination?: string; customerId?: string; referenceNumber?: string };

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
  tenantId, pendingResvs, reqs, highlightResv, highlightReq, pending,
  onApprove, onCancel, onMakeDispatch, loaded, loadErr,
}: {
  tenantId: string;
  pendingResvs: Resv[]; reqs: Req[];
  highlightResv: Set<string>; highlightReq: Set<string>;
  pending: string | null;
  onApprove: (id: string) => void; onCancel: (id: string) => void;
  onMakeDispatch: (id: string, extra: DispatchExtra) => void;
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
      <div data-testid="pending-reservations">
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
      </div>

      <h2>
        درخواست‌های تأییدشده
        {reqs.length > 0 && <span className="badge">{num(reqs.length)}</span>}
      </h2>
      {loaded && !loadErr && reqs.length === 0 && <p className="empty">درخواست تأییدشده‌ای برای حواله نیست.</p>}
      <div data-testid="approved-requests">
      {reqs.map((r) => (
        <ApprovedReqCard key={r.id} r={r} tenantId={tenantId} highlighted={highlightReq.has(r.id)}
          pending={pending} onMakeDispatch={onMakeDispatch} />
      ))}
      </div>
    </>
  );
}

/**
 * کارتِ درخواستِ تأییدشده: دکمه‌ی «ساخت حواله» یک فرمِ کوچکِ محلی (مقصد/مشتری/
 * مرجع، همه اختیاری) باز می‌کند به‌جای ارسالِ مستقیم — spec ۳.۷. باز/بسته‌بودنِ
 * فرم و مقدارِ فیلدها فقط UI-state است (نه دیتای سرور)، پس محلی می‌ماند، برخلافِ
 * بقیه‌ی این فایل که presentational-محض است.
 */
function ApprovedReqCard({
  r, tenantId, highlighted, pending, onMakeDispatch,
}: {
  r: Req; tenantId: string; highlighted: boolean; pending: string | null;
  onMakeDispatch: (id: string, extra: DispatchExtra) => void;
}) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const busy = pending === r.id;

  return (
    <div className={highlighted ? "card card--new" : "card"}>
      <div className="row">
        <strong>{r.agentName}</strong>
        <span className="row row--start" style={{ gap: "var(--sp-2)" }}>
          {highlighted && <span className="badge badge--warn">تازه</span>}
          {(r.assignedStaffName || r.assignedStaffPhone) && (
            <span className="subtle">پشتیبان: {r.assignedStaffName ?? r.assignedStaffPhone}</span>
          )}
          {/* پشتیبان باید ببیند کدام سفارش بدونِ او تأیید شده — وگرنه فیچر بی‌سروصدا کار می‌کند */}
          {r.approvalMode === "auto" && <span className="badge badge--ok">تأیید خودکار (زیر سقف)</span>}
        </span>
      </div>
      <div className="muted">{r.items.map((i) => `${i.name} ×${num(i.qty)}`).join("، ")}</div>

      {!open ? (
        <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
          <button onClick={() => setOpen(true)} disabled={busy} aria-busy={busy}>
            {busy && <span className="spinner" aria-hidden="true" />}ساخت حواله
          </button>
        </div>
      ) : (
        <div style={{ marginTop: "var(--sp-3)" }}>
          <div className="field" style={{ margin: 0, marginBottom: "var(--sp-2)" }}>
            <label htmlFor={`dest-${r.id}`}>مقصد (اختیاری)</label>
            <input id={`dest-${r.id}`} value={destination} disabled={busy}
              onChange={(e) => setDestination(e.target.value)} placeholder="مثلاً: انبارِ مشتری، تهران" />
          </div>
          <div style={{ marginBottom: "var(--sp-2)" }}>
            <CustomerPicker tenantId={tenantId} value={customer} onChange={setCustomer} />
          </div>
          <div className="field" style={{ margin: 0, marginBottom: "var(--sp-2)" }}>
            <label htmlFor={`ref-${r.id}`}>شماره مرجع (اختیاری)</label>
            <input id={`ref-${r.id}`} value={referenceNumber} disabled={busy}
              onChange={(e) => setReferenceNumber(e.target.value)} placeholder="شماره‌ی دفتر یا مرجعِ داخلی" />
          </div>
          <div className="row row--start row--stack-mobile" style={{ gap: "var(--sp-2)" }}>
            <button className="primary" disabled={busy} aria-busy={busy}
              onClick={() => onMakeDispatch(r.id, { destination, customerId: customer?.id, referenceNumber })}>
              {busy && <span className="spinner" aria-hidden="true" />}تأیید و ساختِ حواله
            </button>
            <button className="ghost" disabled={busy} onClick={() => setOpen(false)}>انصراف</button>
          </div>
        </div>
      )}
    </div>
  );
}
