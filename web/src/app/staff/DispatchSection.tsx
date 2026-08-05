import Link from "next/link";
import Icon from "../Icon";

const num = (v: number) => v.toLocaleString("fa-IR");

export type Disp = {
  id: string; dispatchCode: string; status: string;
  customerName: string | null; items: number; warehouseName: string | null;
};

const NEXT: Record<string, string[]> = {
  registered: ["ready_for_loading", "cancelled"],
  ready_for_loading: ["loaded", "cancelled"],
  loaded: ["delivered"],
  delivered: [], cancelled: [],
};
const FA: Record<string, string> = {
  registered: "ثبت‌شده", ready_for_loading: "آماده بارگیری", loaded: "بارگیری‌شده",
  delivered: "تحویل‌شده", cancelled: "لغوشده",
};

/** لیستِ حواله‌ها: جستجو + صفحه‌بندی + پیشروی به وضعیتِ بعدی. صرفاً presentational. */
export default function DispatchSection({
  disps, dispsQ, dispsHasMore, dispsBusy, onSearch, onLoadMore, onAdvance, pending, loaded, loadErr,
}: {
  disps: Disp[]; dispsQ: string; dispsHasMore: boolean; dispsBusy: boolean;
  onSearch: (v: string) => void; onLoadMore: () => void;
  onAdvance: (dispatchId: string, toStatus: string) => void;
  pending: string | null; loaded: boolean; loadErr: string;
}) {
  return (
    <>
      <h2>حواله‌ها</h2>
      <input type="search" aria-label="جستجوی حواله" placeholder="جستجو: کدِ حواله، مشتری، نمایندگی…"
        value={dispsQ} onChange={(e) => onSearch(e.target.value)} style={{ marginBottom: "var(--sp-3)" }} />
      {loaded && !loadErr && disps.length === 0 && <p className="empty">{dispsQ ? "چیزی پیدا نشد." : "حواله‌ای نیست."}</p>}
      <div data-testid="dispatch-list">
      {disps.map((d) => (
        <div className="card" key={d.id}>
          <div className="row">
            <strong className="num">{d.dispatchCode}</strong>
            <span className="row row--start" style={{ gap: "var(--sp-1)" }}>
              {/* انبار badge است نه متن: انباردار باید با یک نگاه بفهمد این حواله مالِ اوست */}
              {d.warehouseName && <span className="badge"><Icon name="warehouse" size={13} />{d.warehouseName}</span>}
              <span className={`badge${d.status === "delivered" || d.status === "loaded" ? " badge--ok" : d.status === "cancelled" ? " badge--error" : ""}`}>
                {FA[d.status] ?? d.status}
              </span>
              <span className="subtle">{num(d.items)} قلم</span>
            </span>
          </div>
          {d.customerName && <div className="muted">{d.customerName}</div>}
          <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
            {(NEXT[d.status] ?? []).map((s) => (
              <button key={s} className={s === "cancelled" ? "danger" : s === "loaded" ? "primary" : undefined}
                onClick={() => onAdvance(d.id, s)} disabled={pending === d.id + s} aria-busy={pending === d.id + s}>
                {pending === d.id + s && <span className="spinner" aria-hidden="true" />}{FA[s]}
              </button>
            ))}
            {/* انباردار روی کاغذ کار می‌کند نه صفحه‌نمایش — لینکِ برگه‌ی چاپی همیشه در دسترس است، حتی حواله‌ی نهایی‌شده */}
            <Link href={`/staff/dispatch/${d.id}/print`} target="_blank">
              <button type="button"><Icon name="printer" size={13} />چاپ</button>
            </Link>
          </div>
        </div>
      ))}
      </div>
      {dispsHasMore && (
        <button onClick={onLoadMore} aria-busy={dispsBusy} disabled={dispsBusy} style={{ width: "100%" }}>
          {dispsBusy && <span className="spinner" aria-hidden="true" />}بیشتر
        </button>
      )}
    </>
  );
}
