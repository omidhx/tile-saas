"use client";
import { useState } from "react";
import { postJson, actionError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";
import type { Product } from "./types";
import { AttrFields, MoreFields, parsePackInt, parsePackNum, type AttrKey } from "./productFields";

export default function EditPanel({
  ctx, product, products, onSaved, onClose, onMsg, onBusyChange,
}: {
  ctx: Ctx; product: Product; products: Product[];
  onSaved: () => Promise<void>; onClose: () => void;
  onMsg: (text: string, ok?: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [editForm, setEditForm] = useState(() => ({
    name: product.name, color: product.color ?? "", glaze: product.glaze ?? "", punch: product.punch ?? "", body: product.body ?? "",
    size: product.size ?? "", thickness: product.thickness ?? "", usageArea: product.usageArea ?? "", description: product.description ?? "",
    boxesPerPallet: product.boxesPerPallet != null ? String(product.boxesPerPallet) : "",
    sqmPerBox: product.sqcmPerBox != null ? String(product.sqcmPerBox / 10000) : "",
  }));
  const [pending, setPending] = useState(false);

  const distinctVal = (key: AttrKey) =>
    [...new Set(products.map((p) => p[key]).filter((v): v is string => !!v))].sort();

  async function save() {
    if (!editForm.name.trim()) return;
    const bpp = parsePackInt(editForm.boxesPerPallet);
    const spb = parsePackNum(editForm.sqmPerBox);
    if (!bpp.ok || !spb.ok) { onMsg("تعداد کارتن در پالت یا متراژِ هر کارتن نامعتبر است."); return; }
    setPending(true); onBusyChange(true); onMsg("");
    const res = await postJson("/api/products", {
      tenantId: ctx.tenantId, productId: product.id, ...editForm, variantId: product.variantId ?? undefined,
      boxesPerPallet: bpp.value, sqcmPerBox: spb.value != null ? Math.round(spb.value * 10000) : null,
    }, "PATCH");
    if (!res.ok) onMsg(actionError(res.status));
    else { onMsg("محصول ویرایش شد.", true); await onSaved(); }
    setPending(false); onBusyChange(false);
    if (res.ok) onClose();
  }

  return (
    <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-3)", borderTop: "1px solid var(--line)" }}>
      <div className="grid2">
        <div><label htmlFor={`en-${product.id}`}>نام *</label>
          <input id={`en-${product.id}`} value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
        <div><label>کد <span className="subtle">(قفل)</span></label>
          <input value={product.code} disabled aria-label="کد (غیرقابل ویرایش)" /></div>
        <div><label>sku <span className="subtle">(قفل)</span></label>
          <input value={product.sku ?? ""} disabled aria-label="sku (غیرقابل ویرایش)" /></div>
      </div>
      <AttrFields v={editForm} set={(patch) => setEditForm((s) => ({ ...s, ...patch }))} keyId={product.id} distinctVal={distinctVal} />
      <MoreFields v={editForm} set={(patch) => setEditForm((s) => ({ ...s, ...patch }))} keyId={product.id} distinctVal={distinctVal} />
      <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
        <button className="primary" disabled={pending || !editForm.name.trim()} onClick={save}>
          {pending && <span className="spinner" aria-hidden="true" />}ذخیره
        </button>
        <button className="ghost" onClick={onClose}>انصراف</button>
      </div>
    </div>
  );
}
