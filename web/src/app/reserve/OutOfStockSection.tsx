import Icon from "../Icon";
import { formatJalaliDate } from "@/lib/date";
import { formatMoney, type CurrencyUnit } from "@/lib/money";

const money = (v: number) => v.toLocaleString("fa-IR");

export type WaitlistEntry = { variantId: string; name: string; code: string; quantityBoxes: number; position: number };
export type Arrival = { quantityBoxes: number; expectedAt: string; status: "planned" | "confirmed" };
export type Substitute = {
  variantId: string; name: string; code: string; grade: string | null;
  available: number; unitPrice: number | null; note: string | null;
  source: "explicit" | "same_product";
};
export type OutOfStockItem = { variantId: string; name: string; code: string };

/**
 * «ناموجودها»: اعلانِ SMS + نوبت + کِی‌می‌رسد + جایگزین‌ها. صرفاً presentational —
 * همه‌ی state/دیتافچ در reserve/page.tsx می‌ماند.
 */
export default function OutOfStockSection({
  outOfStock, subscribed, queue, queueQty, alertPending, queuePending, subs, arrivals,
  onToggleAlert, onJoinQueue, onLeaveQueue, onQueueQtyChange, currencyUnit,
}: {
  outOfStock: OutOfStockItem[]; subscribed: string[]; queue: WaitlistEntry[];
  queueQty: Record<string, string>; alertPending: string | null; queuePending: string | null;
  subs: Record<string, Substitute[]>; arrivals: Record<string, Arrival[]>;
  onToggleAlert: (variantId: string, on: boolean) => void;
  onJoinQueue: (variantId: string) => void; onLeaveQueue: (variantId: string) => void;
  onQueueQtyChange: (variantId: string, v: string) => void; currencyUnit: CurrencyUnit;
}) {
  if (outOfStock.length === 0) return null;
  return (
    <>
      <h2>ناموجودها</h2>
      {/* دو گزینه‌ی متفاوت که راحت با هم اشتباه می‌شوند، پس تفاوتشان صریح گفته
          می‌شود: یکی فقط خبر می‌دهد، دیگری واقعاً موجودی را نگه می‌دارد. */}
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          <strong>خبرم کن</strong>: به‌محض موجود شدن یک پیامک می‌گیری — ولی موجودی برایت
          نگه داشته نمی‌شود و هرکس زودتر سفارش دهد می‌برد.<br />
          <strong>نوبت بگیر</strong>: به‌ترتیبِ نوبت، به‌محض آزاد شدن موجودی همان تعداد
          <strong> برایت رزرو می‌شود</strong>.
        </span>
      </div>
      {outOfStock.map((v) => {
        const on = subscribed.includes(v.variantId);
        const q = queue.find((w) => w.variantId === v.variantId);
        const qty = Number(queueQty[v.variantId]);
        return (
          <div className="card" key={v.variantId}>
            <div className="row">
              <span><strong>{v.name}</strong> <span className="subtle">{v.code}</span></span>
              <button className={on ? "primary" : "ghost"} disabled={alertPending === v.variantId}
                aria-busy={alertPending === v.variantId}
                onClick={() => onToggleAlert(v.variantId, !on)}>
                {alertPending === v.variantId
                  ? <span className="spinner" aria-hidden="true" />
                  : <Icon name="bell" />}
                {on ? "خبرم بده (فعال)" : "خبرم کن"}
              </button>
            </div>

            {q ? (
              <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
                <span className="badge badge--ok">
                  <Icon name="queue" size={13} />
                  نفر {money(q.position)} · {money(q.quantityBoxes)} کارتن
                </span>
                <button className="ghost" disabled={queuePending === v.variantId}
                  aria-busy={queuePending === v.variantId}
                  onClick={() => onLeaveQueue(v.variantId)}>
                  {queuePending === v.variantId && <span className="spinner" aria-hidden="true" />}
                  انصراف از نوبت
                </button>
              </div>
            ) : (
              <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
                <label htmlFor={`wl-${v.variantId}`} className="sr-only">تعداد کارتن برای نوبتِ {v.name}</label>
                <input id={`wl-${v.variantId}`} type="number" min={1} inputMode="numeric" placeholder="تعداد کارتن"
                  style={{ maxWidth: 150 }}
                  value={queueQty[v.variantId] ?? ""}
                  onChange={(e) => onQueueQtyChange(v.variantId, e.target.value)} />
                <button disabled={queuePending === v.variantId || !(qty > 0)}
                  aria-busy={queuePending === v.variantId}
                  onClick={() => onJoinQueue(v.variantId)}>
                  {queuePending === v.variantId && <span className="spinner" aria-hidden="true" />}
                  نوبت بگیر
                </button>
              </div>
            )}

            {/* «کِی می‌رسد» — همان چیزی که در v1 کم بود. نماینده باید بتواند بین
                صبر کردن و گرفتنِ جایگزین انتخاب کند، و بدونِ تاریخ نمی‌تواند. */}
            {(arrivals[v.variantId] ?? []).length > 0 && (
              <div className="banner banner--info" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
                <Icon name="clock" />
                <span>
                  {(arrivals[v.variantId] ?? []).map((a, i) => (
                    <div key={i}>
                      <strong>{money(a.quantityBoxes)} کارتن</strong> در راه —
                      حدودِ {formatJalaliDate(a.expectedAt)}
                      {a.status === "planned"
                        ? <span className="subtle"> (برنامه‌ریزی‌شده، هنوز قطعی نیست)</span>
                        : <span className="subtle"> (قطعی‌شده)</span>}
                    </div>
                  ))}
                </span>
              </div>
            )}

            {/* جایگزین‌ها دقیقاً همین‌جا می‌آیند — جایی که نماینده تازه فهمیده
                کالا نیست. فرستادنش به بالای صفحه برای پیدا کردنِ مشابه، همان
                فروشی است که از دست می‌رود. */}
            {(subs[v.variantId] ?? []).length > 0 && (
              <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
                <div className="muted" style={{ marginBottom: "var(--sp-2)" }}>به‌جایش موجود است:</div>
                {(subs[v.variantId] ?? []).map((s) => (
                  <div className="row" key={s.variantId} style={{ marginBottom: "var(--sp-2)" }}>
                    <span>
                      <strong>{s.name}</strong> <span className="subtle">{s.code}</span>
                      {s.grade ? <span className="subtle"> · درجه {s.grade}</span> : null}
                      {/* منبعِ پیشنهاد صریح گفته می‌شود: «کارخانه گفته» با
                          «سیستم حدس زده» برای نماینده یکی نیست. */}
                      {s.note
                        ? <div className="subtle">{s.note}</div>
                        : s.source === "same_product"
                          ? <div className="subtle">همین کالا با درجه‌ی دیگر</div>
                          : null}
                    </span>
                    <span style={{ textAlign: "start" }}>
                      <span className="metric">{money(s.available)}</span> <span className="muted">کارتن</span>
                      {s.unitPrice !== null && (
                        <div className="subtle num">{formatMoney(s.unitPrice, currencyUnit)} / کارتن</div>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
