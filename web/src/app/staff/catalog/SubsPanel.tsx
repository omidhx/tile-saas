"use client";
import { useState } from "react";
import { postJson, actionError } from "@/lib/api";
import { matches } from "@/lib/search";
import type { Ctx } from "@/lib/useContexts";
import type { Product, Sub } from "./types";

export default function SubsPanel({
  ctx, product, products, subs, onSaved, onMsg,
}: {
  ctx: Ctx; product: Product; products: Product[]; subs: Sub[];
  onSaved: () => Promise<void>; onMsg: (text: string, ok?: boolean) => void;
}) {
  const [subPick, setSubPick] = useState("");
  const [subNote, setSubNote] = useState("");
  const [subQuery, setSubQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const variantId = product.variantId!;

  async function addSub() {
    if (!subPick) return;
    setPending("sub" + variantId); onMsg("");
    const res = await postJson("/api/substitutes",
      { tenantId: ctx.tenantId, variantId, substituteVariantId: subPick, note: subNote });
    if (!res.ok) onMsg(actionError(res.status));
    else { setSubPick(""); setSubNote(""); await onSaved(); }
    setPending(null);
  }

  async function removeSub(id: string) {
    setPending("subdel" + id); onMsg("");
    const res = await postJson("/api/substitutes", { tenantId: ctx.tenantId, id }, "DELETE");
    if (!res.ok) onMsg(actionError(res.status));
    else await onSaved();
    setPending(null);
  }

  const cands = products.filter((o) => o.variantId && o.variantId !== variantId
    && !subs.some((s) => s.variantId === variantId && s.substituteVariantId === o.variantId)
    && matches(subQuery, [o.name, o.code]));

  return (
    <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
      <div className="subtle" style={{ marginBottom: "var(--sp-2)" }}>
        اگر <strong>{product.name}</strong> نبود، این‌ها پیشنهاد می‌شوند (فقط موجودها به نماینده می‌روند):
      </div>
      {subs.filter((s) => s.variantId === variantId).map((s) => (
        <div className="row" key={s.id} style={{ marginBottom: "var(--sp-1)" }}>
          <span>{s.substituteName} <span className="subtle num">{s.substituteCode}</span>
            {s.note ? <span className="subtle"> — {s.note}</span> : null}</span>
          <button className="danger" disabled={pending === "subdel" + s.id}
            onClick={() => removeSub(s.id)}>حذف</button>
        </div>
      ))}
      <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-2)" }}>
        <input type="search" value={subQuery} onChange={(e) => setSubQuery(e.target.value)}
          placeholder="جستجوی نام یا کد…" aria-label="جستجوی جایگزین" style={{ maxWidth: 180 }} />
        <select value={subPick} onChange={(e) => setSubPick(e.target.value)} aria-label="کالای جایگزین" style={{ maxWidth: 240 }}>
          <option value="">{cands.length ? "انتخاب جایگزین…" : "موردی یافت نشد"}</option>
          {cands.map((o) => <option key={o.variantId} value={o.variantId!}>{o.name} ({o.code})</option>)}
        </select>
        <input value={subNote} onChange={(e) => setSubNote(e.target.value)}
          placeholder="توضیح (اختیاری)" style={{ maxWidth: 200 }} aria-label="توضیح جایگزین" />
        <button className="primary" disabled={pending === "sub" + variantId || !subPick}
          onClick={addSub}>افزودن جایگزین</button>
      </div>
    </div>
  );
}
