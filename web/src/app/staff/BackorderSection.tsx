const num = (v: number) => v.toLocaleString("fa-IR");

export type Agent = { id: string; legalName: string };
export type Variant = { id: string; name: string; code: string; sku: string };
export type Backorder = {
  id: string; status: string; qty: number; name: string; code: string;
  dispatchCode: string; agentName: string;
};

const BO_NEXT: Record<string, string[]> = {
  pending_production: ["ready", "cancelled"], ready: ["fulfilled", "cancelled"], fulfilled: [], cancelled: [],
};
const BO_FA: Record<string, string> = {
  pending_production: "در انتظار تولید", ready: "آماده", fulfilled: "تحویل‌شده", cancelled: "لغوشده",
};

/** ثبت + لیستِ backorder (محصولِ ناموجود). صرفاً presentational. */
export default function BackorderSection({
  agents, variants, boAgent, boVariant, boQty, onAgentChange, onVariantChange, onQtyChange, onCreate,
  backorders, boListQ, boHasMore, boBusy, onSearch, onLoadMore, onAdvance, pending, loaded, loadErr,
}: {
  agents: Agent[]; variants: Variant[];
  boAgent: string; boVariant: string; boQty: string;
  onAgentChange: (v: string) => void; onVariantChange: (v: string) => void; onQtyChange: (v: string) => void;
  onCreate: () => void;
  backorders: Backorder[]; boListQ: string; boHasMore: boolean; boBusy: boolean;
  onSearch: (v: string) => void; onLoadMore: () => void;
  onAdvance: (itemId: string, toStatus: string) => void;
  pending: string | null; loaded: boolean; loadErr: string;
}) {
  return (
    <>
      <h2>Backorder (محصول ناموجود)</h2>
      <div className="card">
        <strong>ثبت backorder جدید</strong>
        <div className="row row--start row--stack-mobile" style={{ gap: "var(--sp-2)", alignItems: "flex-end" }}>
          <div className="field" style={{ margin: 0, maxWidth: 200 }}>
            <label htmlFor="bo-agent">نمایندگی</label>
            <select id="bo-agent" value={boAgent} onChange={(e) => onAgentChange(e.target.value)}>
              <option value="">نمایندگی…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.legalName}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, maxWidth: 240 }}>
            <label htmlFor="bo-variant">کالا</label>
            <select id="bo-variant" value={boVariant} onChange={(e) => onVariantChange(e.target.value)}>
              <option value="">کالا…</option>
              {variants.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, maxWidth: 110 }}>
            <label htmlFor="bo-qty">کارتن</label>
            <input id="bo-qty" type="number" min={1} placeholder="کارتن" value={boQty}
              onChange={(e) => onQtyChange(e.target.value)} />
          </div>
          <button onClick={onCreate} aria-busy={pending === "bo-create"}
            disabled={pending === "bo-create" || !boAgent || !boVariant || Number(boQty) <= 0}>
            {pending === "bo-create" && <span className="spinner" aria-hidden="true" />}ثبت
          </button>
        </div>
      </div>
      <input type="search" aria-label="جستجوی backorder" placeholder="جستجو: کالا، کد، نمایندگی، کدِ حواله…"
        value={boListQ} onChange={(e) => onSearch(e.target.value)} style={{ marginBottom: "var(--sp-3)" }} />
      {loaded && !loadErr && backorders.length === 0 && <p className="empty">{boListQ ? "چیزی پیدا نشد." : "backorderی نیست."}</p>}
      {backorders.map((b) => (
        <div className="card" key={b.id}>
          <div className="row">
            <strong>{b.name} <span className="subtle">{b.code}</span> ×{num(b.qty)}</strong>
            <span className={`badge${b.status === "fulfilled" ? " badge--ok" : b.status === "cancelled" ? " badge--error" : " badge--warn"}`}>
              {BO_FA[b.status] ?? b.status}
            </span>
          </div>
          <div className="muted">{b.agentName} · <span className="num">{b.dispatchCode}</span></div>
          <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
            {(BO_NEXT[b.status] ?? []).map((s) => (
              <button key={s} className={s === "cancelled" ? "danger" : s === "fulfilled" ? "primary" : undefined}
                onClick={() => onAdvance(b.id, s)} disabled={pending === "bo" + b.id + s}
                aria-busy={pending === "bo" + b.id + s}>
                {pending === "bo" + b.id + s && <span className="spinner" aria-hidden="true" />}{BO_FA[s]}
              </button>
            ))}
          </div>
        </div>
      ))}
      {boHasMore && (
        <button onClick={onLoadMore} aria-busy={boBusy} disabled={boBusy} style={{ width: "100%" }}>
          {boBusy && <span className="spinner" aria-hidden="true" />}بیشتر
        </button>
      )}
    </>
  );
}
