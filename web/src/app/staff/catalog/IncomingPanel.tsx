"use client";
import { useState } from "react";
import { postJson, actionError } from "@/lib/api";
import { JalaliDateInput } from "@/lib/JalaliDateInput";
import { formatJalaliDate, jalaliToDate, todayJalali, type Jalali } from "@/lib/date";
import type { Ctx } from "@/lib/useContexts";
import { money, type Product, type Wh, type IncomingItem } from "./types";

const INCOMING_STATUS_FA: Record<string, string> = {
  planned: "برنامه‌ریزی‌شده", confirmed: "قطعی‌شده", arrived: "رسیده", cancelled: "لغوشده",
};
const INCOMING_SOURCE_FA: Record<string, string> = {
  production: "تولید", transfer: "انتقال بین انبار", purchase: "خرید",
};

export default function IncomingPanel({
  ctx, product, whs, incomingItems, onSaved, onMsg,
}: {
  ctx: Ctx; product: Product; whs: Wh[]; incomingItems: IncomingItem[];
  onSaved: () => Promise<void>; onMsg: (text: string, ok?: boolean) => void;
}) {
  const [incWarehouseId, setIncWarehouseId] = useState("");
  const [incQty, setIncQty] = useState("");
  const [incWhen, setIncWhen] = useState<Jalali>(todayJalali);
  const [incSource, setIncSource] = useState("production");
  const [incNote, setIncNote] = useState("");
  const [incArriving, setIncArriving] = useState<string | null>(null);
  const [incBatch, setIncBatch] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const variantId = product.variantId!;

  async function addIncoming() {
    if (!incWarehouseId || Number(incQty) <= 0) return;
    setPending("incadd"); onMsg("");
    const res = await postJson("/api/incoming", {
      tenantId: ctx.tenantId, variantId, warehouseId: incWarehouseId,
      quantityBoxes: Number(incQty),
      expectedAt: jalaliToDate(incWhen).toISOString().slice(0, 10),
      source: incSource, note: incNote,
    });
    if (!res.ok) onMsg(actionError(res.status));
    else {
      setIncQty(""); setIncNote(""); onMsg("محموله ثبت شد.", true);
      await onSaved();
    }
    setPending(null);
  }

  async function actIncoming(id: string, action: "arrive" | "confirm" | "cancel", batchNumber?: string) {
    setPending(id + action); onMsg("");
    const res = await postJson("/api/incoming", { tenantId: ctx.tenantId, id, action, batchNumber }, "PATCH");
    if (!res.ok) onMsg(actionError(res.status));
    else {
      if (action === "arrive") {
        const d = res.data as { offers?: number; notified?: number };
        onMsg(`موجودی وارد شد.${d.offers ? ` ${money(d.offers)} نوبت از صف انتظار پر شد.` : ""}`
          + `${d.notified ? ` ${money(d.notified)} اعلان «موجود شد» صف شد.` : ""}`, true);
        setIncArriving(null); setIncBatch("");
      } else onMsg("انجام شد.", true);
      await onSaved();
    }
    setPending(null);
  }

  return (
    <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
      <div className="subtle" style={{ marginBottom: "var(--sp-2)" }}>
        محموله‌ی در راه قابلِ سفارش نیست و در موجودی شمرده نمی‌شود — فقط تاریخِ تقریبیِ رسیدن را
        به نماینده نشان می‌دهد. با زدنِ «رسید»، موجودیِ واقعی وارد می‌شود.
      </div>
      <div className="grid2">
        <div><label htmlFor={`iw-${product.id}`}>انبار مقصد</label>
          <select id={`iw-${product.id}`} value={incWarehouseId} onChange={(e) => setIncWarehouseId(e.target.value)}>
            <option value="">انتخاب انبار…</option>
            {whs.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
          </select></div>
        <div><label htmlFor={`iq-${product.id}`}>تعداد کارتن</label>
          <input id={`iq-${product.id}`} type="number" min={1} inputMode="numeric" value={incQty}
            onChange={(e) => setIncQty(e.target.value)} /></div>
      </div>
      <label style={{ marginBottom: 0 }}>تاریخ تقریبی رسیدن</label>
      <JalaliDateInput label="" value={incWhen} onChange={setIncWhen} currentYear={todayJalali().jy + 1} />
      <div className="grid2">
        <div><label htmlFor={`is-${product.id}`}>منبع</label>
          <select id={`is-${product.id}`} value={incSource} onChange={(e) => setIncSource(e.target.value)}>
            <option value="production">تولید</option>
            <option value="transfer">انتقال بین انبار</option>
            <option value="purchase">خرید</option>
          </select></div>
        <div><label htmlFor={`in-${product.id}`}>توضیح (اختیاری)</label>
          <input id={`in-${product.id}`} value={incNote} onChange={(e) => setIncNote(e.target.value)} placeholder="مثلاً: بچ تولید مهر" /></div>
      </div>
      <button className="primary" onClick={addIncoming} aria-busy={pending === "incadd"}
        disabled={pending === "incadd" || !incWarehouseId || Number(incQty) <= 0}
        style={{ width: "100%", marginTop: "var(--sp-2)" }}>
        {pending === "incadd" && <span className="spinner" aria-hidden="true" />}ثبت محموله
      </button>

      {incomingItems.filter((i) => i.variantId === variantId).map((i) => (
        <div className="card" key={i.id} style={{ marginTop: "var(--sp-3)" }}>
          <div className="row">
            <span className={`badge ${i.status === "confirmed" ? "badge--ok" : "badge--warn"}`}>
              {INCOMING_STATUS_FA[i.status]}
            </span>
          </div>
          <div className="muted">
            <span className="metric">{money(i.quantityBoxes)}</span> کارتن → {i.warehouseName}
            {" · "}حدودِ {formatJalaliDate(i.expectedAt)}
            {" · "}{INCOMING_SOURCE_FA[i.source] ?? i.source}
          </div>
          {i.note && <div className="subtle">{i.note}</div>}

          {i.status === "arrived" || i.status === "cancelled" ? null : incArriving === i.id ? (
            <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
              <label htmlFor={`batch-${i.id}`} className="sr-only">شماره بچ برای {product.name}</label>
              <input id={`batch-${i.id}`} value={incBatch} onChange={(e) => setIncBatch(e.target.value)}
                     placeholder="شماره بچ (اختیاری)" style={{ maxWidth: 200 }} autoFocus />
              <button className="primary" onClick={() => actIncoming(i.id, "arrive", incBatch.trim() || undefined)}
                      aria-busy={pending === i.id + "arrive"} disabled={pending === i.id + "arrive"}>
                {pending === i.id + "arrive" && <span className="spinner" aria-hidden="true" />}تأیید رسیدن
              </button>
              <button className="ghost" onClick={() => { setIncArriving(null); setIncBatch(""); }}>انصراف</button>
            </div>
          ) : (
            <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
              <button className="primary" onClick={() => { setIncArriving(i.id); setIncBatch(""); }}>رسید</button>
              {i.status === "planned" && (
                <button className="ghost" onClick={() => actIncoming(i.id, "confirm")}
                        aria-busy={pending === i.id + "confirm"} disabled={pending === i.id + "confirm"}>
                  قطعی شد
                </button>
              )}
              <button className="danger" onClick={() => actIncoming(i.id, "cancel")}
                      aria-busy={pending === i.id + "cancel"} disabled={pending === i.id + "cancel"}>
                لغو
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
