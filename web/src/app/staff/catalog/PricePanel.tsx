"use client";
import { useState } from "react";
import { postJson, actionError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";
import type { Product, PriceList, PriceItem } from "./types";

export default function PricePanel({
  ctx, product, priceLists, priceItems, onSaved, onMsg, onGoImport,
}: {
  ctx: Ctx; product: Product; priceLists: PriceList[]; priceItems: PriceItem[];
  onSaved: () => Promise<void>; onMsg: (text: string, ok?: boolean) => void; onGoImport: () => void;
}) {
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});
  const [priceSaving, setPriceSaving] = useState<string | null>(null);
  const variantId = product.variantId!;

  async function savePrice(priceListId: string) {
    const key = priceListId + variantId;
    const raw = priceDraft[key];
    const price = Number(raw);
    if (!Number.isInteger(price) || price < 0) { onMsg("قیمت باید عددِ صحیحِ نامنفی باشد (ریال)."); return; }
    setPriceSaving(key); onMsg("");
    const res = await postJson("/api/prices", { tenantId: ctx.tenantId, priceListId, variantId, price });
    if (!res.ok) onMsg(actionError(res.status));
    else {
      setPriceDraft((s) => { const n = { ...s }; delete n[key]; return n; });
      await onSaved();
    }
    setPriceSaving(null);
  }

  if (priceLists.length === 0)
    return (
      <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
        <p className="subtle">هنوز لیست قیمتی ساخته نشده. <button className="ghost" onClick={onGoImport}>ساختِ سبدِ قیمت</button></p>
      </div>
    );

  return (
    <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
      {priceLists.map((pl) => {
        const existing = priceItems.find((i) => i.priceListId === pl.id && i.variantId === variantId);
        const key = pl.id + variantId;
        const val = priceDraft[key] ?? (existing ? existing.price : "");
        const dirty = priceDraft[key] !== undefined && priceDraft[key] !== (existing ? existing.price : "");
        return (
          <div key={pl.id} className="row row--start row--stack-mobile" style={{ marginBottom: "var(--sp-2)" }}>
            <span className="subtle">{pl.name}</span>
            <label htmlFor={`price-${key}`} className="sr-only">قیمت {product.name} در {pl.name}</label>
            <input id={`price-${key}`} type="number" min={0} step={1} inputMode="numeric" placeholder="قیمت (ریال)"
              value={val} style={{ maxWidth: 200 }}
              onChange={(e) => setPriceDraft((s) => ({ ...s, [key]: e.target.value }))} />
            <button onClick={() => savePrice(pl.id)} aria-busy={priceSaving === key}
              className={dirty ? "primary" : undefined}
              disabled={priceSaving === key || val === "" || !dirty}>
              {priceSaving === key && <span className="spinner" aria-hidden="true" />}
              {dirty ? "ذخیره" : "ذخیره شده"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
