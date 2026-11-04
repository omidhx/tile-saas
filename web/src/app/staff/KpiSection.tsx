import Icon from "../Icon";

const num = (v: number) => v.toLocaleString("fa-IR");

export type LowStockItem = { variantId: string; name: string; code: string; available: number };
export type DashboardKpis = { todayDispatches: number; todayBoxes: number; lowStock: LowStockItem[] };

/** ردیفِ KPIِ صفحه‌ی اول: فروشِ امروز + کالای رو به اتمام. صرفاً presentational. */
export default function KpiSection({ kpis }: { kpis: DashboardKpis | null }) {
  if (!kpis) return null;
  return (
    <div className="row row--start" style={{ gap: "var(--sp-3)", flexWrap: "wrap", marginBottom: "var(--sp-4)" }}>
      <div className="card" style={{ flex: "1 1 200px", margin: 0 }}>
        <div className="subtle">حواله‌ی امروز</div>
        <div className="metric" style={{ fontSize: "1.4rem" }}>{num(kpis.todayDispatches)}</div>
      </div>
      <div className="card" style={{ flex: "1 1 200px", margin: 0 }}>
        <div className="subtle">کارتنِ بارگیری‌شده‌ی امروز</div>
        <div className="metric" style={{ fontSize: "1.4rem" }}>{num(kpis.todayBoxes)}</div>
      </div>
      {kpis.lowStock.length > 0 && (
        <div className="card" style={{ flex: "2 1 320px", margin: 0 }}>
          <div className="row">
            <span className="subtle"><Icon name="alert" size={13} /> رو به اتمام</span>
          </div>
          <div className="row row--start" style={{ gap: "var(--sp-2)", flexWrap: "wrap", marginTop: "var(--sp-2)" }}>
            {kpis.lowStock.map((v) => (
              <span key={v.variantId} className="badge badge--warn">
                {v.name} ({v.code}) — {num(v.available)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
