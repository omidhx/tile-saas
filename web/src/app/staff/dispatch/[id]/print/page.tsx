"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getJson, loadError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";
import { formatJalaliDateTime } from "@/lib/date";
import { formatMoney, formatMoneyWords } from "@/lib/money";
import Icon from "../../../../Icon";

const num = (v: number) => v.toLocaleString("fa-IR");

const FA: Record<string, string> = {
  registered: "ثبت‌شده", ready_for_loading: "آماده بارگیری", loaded: "بارگیری‌شده",
  delivered: "تحویل‌شده", cancelled: "لغوشده",
};

type Item = {
  productName: string; productCode: string; sku: string; grade: string | null;
  batchNumber: string | null; shadeCode: string | null; caliberCode: string | null;
  binLocation: string | null; quantityBoxes: number;
};
type Detail = {
  dispatchCode: string; status: string; customerName: string | null; destination: string | null;
  referenceNumber: string | null; agentLegalName: string; warehouseName: string | null;
  createdAt: string; items: Item[]; totalValue: number | null;
};

/** برگه‌ی چاپیِ حواله — لیستِ برداشتِ انباردار: سرِ حواله + هر قلم با بچ/شید/کالیبر/محل، به‌علاوه‌ی خطِ امضا. */
export default function DispatchPrintPage() {
  const { id } = useParams<{ id: string }>();
  const { ctx, state } = useContexts("staff");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    if (!ctx) return;
    (async () => {
      const res = await getJson<{ dispatch: Detail }>(`/api/sales-dispatches/${id}?tenantId=${ctx.tenantId}`);
      if (res.ok) setDetail(res.data.dispatch);
      else setLoadErr(loadError(res.status));
    })();
  }, [ctx, id]);

  if (state === "loading" || (ctx && !detail && !loadErr))
    return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;
  if (state === "none")
    return <main><div className="banner banner--error" role="alert"><Icon name="alert" /><span>دسترسی نداری.</span></div></main>;
  if (loadErr)
    return <main><div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div></main>;
  if (!detail || !ctx) return null;

  return (
    <main className="print-sheet">
      <div className="row no-print" style={{ marginBottom: "var(--sp-4)" }}>
        <h1 style={{ margin: 0 }}>برگه‌ی حواله</h1>
        <button onClick={() => window.print()}><Icon name="printer" />چاپ</button>
      </div>

      <div className="row">
        <strong className="num" style={{ fontSize: "1.3rem" }}>{detail.dispatchCode}</strong>
        <span className={`badge${detail.status === "cancelled" ? " badge--error" : ""}`}>{FA[detail.status] ?? detail.status}</span>
      </div>

      <div className="grid2" style={{ margin: "var(--sp-3) 0" }}>
        <div><span className="subtle">نمایندگی: </span>{detail.agentLegalName}</div>
        {detail.customerName && <div><span className="subtle">مشتری: </span>{detail.customerName}</div>}
        {detail.warehouseName && <div><span className="subtle">انبار: </span>{detail.warehouseName}</div>}
        {detail.destination && <div><span className="subtle">مقصد: </span>{detail.destination}</div>}
        {detail.referenceNumber && <div><span className="subtle">شماره دفتر: </span><span className="num">{detail.referenceNumber}</span></div>}
        <div><span className="subtle">تاریخ: </span><span className="num">{formatJalaliDateTime(detail.createdAt)}</span></div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["ردیف", "کد", "کالا", "درجه", "بچ", "شید", "کالیبر", "محل", "کارتن"].map((h) => (
              <th key={h} style={{ textAlign: "start", borderBottom: "2px solid var(--line-strong)", padding: "var(--sp-2)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {detail.items.map((it, i) => (
            <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
              <td className="num" style={{ padding: "var(--sp-2)" }}>{num(i + 1)}</td>
              <td className="num" style={{ padding: "var(--sp-2)" }}>{it.productCode}</td>
              <td style={{ padding: "var(--sp-2)" }}>{it.productName}</td>
              <td style={{ padding: "var(--sp-2)" }}>{it.grade ?? "—"}</td>
              <td className="num" style={{ padding: "var(--sp-2)" }}>{it.batchNumber ?? "—"}</td>
              <td className="num" style={{ padding: "var(--sp-2)" }}>{it.shadeCode ?? "—"}</td>
              <td className="num" style={{ padding: "var(--sp-2)" }}>{it.caliberCode ?? "—"}</td>
              <td className="num" style={{ padding: "var(--sp-2)" }}>{it.binLocation ?? "—"}</td>
              <td className="num" style={{ padding: "var(--sp-2)", fontWeight: 600 }}>{num(it.quantityBoxes)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail.totalValue != null && (
        <div className="row" style={{ marginTop: "var(--sp-4)", justifyContent: "flex-end" }}>
          <div style={{ textAlign: "start" }}>
            <div><span className="subtle">جمعِ فاکتور: </span><strong className="metric">{formatMoney(detail.totalValue, ctx.currencyUnit)}</strong></div>
            <div className="subtle">{formatMoneyWords(detail.totalValue, ctx.currencyUnit)}</div>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: "var(--sp-6)", alignItems: "flex-end" }}>
        <div style={{ borderTop: "1px solid var(--text)", paddingTop: "var(--sp-2)", width: "45%" }}>امضاءِ انباردار</div>
        <div style={{ borderTop: "1px solid var(--text)", paddingTop: "var(--sp-2)", width: "45%" }}>امضاءِ تحویل‌گیرنده / راننده</div>
      </div>
    </main>
  );
}
