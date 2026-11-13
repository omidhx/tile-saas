"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../../Icon";
import DeleteButton from "../../DeleteButton";
import { getJson, postJson, loadError, actionError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";

const n = (v: number) => v.toLocaleString("fa-IR");
const ALL = ""; // مقدارِ selectِ «همه» — روی سیم به null تبدیل می‌شود

type PriceList = { id: string; name: string };
type Variant = { id: string; name: string; code: string; sku: string };
type Tier = {
  id: string; priceListId: string | null; variantId: string | null;
  minQtyBoxes: number; percentOff: number; productName: string | null; productCode: string | null;
};

/**
 * پله‌های تخفیفِ حجمی — تا حالا فقط با SQL قابلِ دیدن/تغییر بود (حتی خودِ
 * GETِ پنل قیمت‌گذاری آن‌ها را می‌گرفت ولی هیچ‌جا نشانشان نمی‌داد).
 *
 * نکته‌ی مهمِ UX که باید صریح گفته شود: پله‌ها **جمع نمی‌شوند** — موتورِ قیمت
 * (`resolvePricesIn`) بینِ همه‌ی پله‌های واجدشرایط، فقط بیشترین درصد را
 * برمی‌دارد. کسی که از منطقِ «هرچه بیشتر بخری روی همان قبلی هم تخفیف می‌گیری»
 * می‌آید، بدونِ این توضیح گیج می‌شود.
 */
export default function VolumeDiscountSection({ ctx }: { ctx: Ctx }) {
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [newPriceListId, setNewPriceListId] = useState(ALL);
  const [newVariantId, setNewVariantId] = useState(ALL);
  const [newMinQty, setNewMinQty] = useState("");
  const [newPercent, setNewPercent] = useState("");
  const [createErr, setCreateErr] = useState("");
  const [creating, setCreating] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editMinQty, setEditMinQty] = useState("");
  const [editPercent, setEditPercent] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState("");

  const load = useCallback(async (tenantId: string) => {
    const [pl, cat] = await Promise.all([
      getJson<{ lists: PriceList[]; tiers: Tier[] }>(`/api/prices?tenantId=${tenantId}`),
      getJson<{ variants: Variant[] }>(`/api/catalog?tenantId=${tenantId}`),
    ]);
    if (pl.ok) { setPriceLists(pl.data.lists); setTiers(pl.data.tiers); setLoadErr(""); }
    else setLoadErr(loadError(pl.status));
    if (cat.ok) setVariants(cat.data.variants);
    setLoaded(true);
  }, []);
  useEffect(() => { load(ctx.tenantId); }, [ctx.tenantId, load]);

  async function createTier() {
    const minQtyBoxes = Number(newMinQty), percentOff = Number(newPercent);
    if (!Number.isInteger(minQtyBoxes) || minQtyBoxes <= 0 || !Number.isInteger(percentOff) || percentOff <= 0 || percentOff > 100) return;
    setCreating(true); setCreateErr("");
    const res = await postJson("/api/volume-discounts", {
      tenantId: ctx.tenantId, priceListId: newPriceListId || null, variantId: newVariantId || null,
      minQtyBoxes, percentOff,
    });
    setCreating(false);
    if (!res.ok) {
      setCreateErr(res.error === "duplicate" ? "دقیقاً همین پله (همین سبد/کالا/حداقل) قبلاً ثبت شده." : actionError(res.status));
      return;
    }
    setNewMinQty(""); setNewPercent("");
    await load(ctx.tenantId);
  }

  function startEdit(t: Tier) {
    setEditId(t.id); setEditMinQty(String(t.minQtyBoxes)); setEditPercent(String(t.percentOff)); setRowErr("");
  }

  async function saveEdit(id: string) {
    const minQtyBoxes = Number(editMinQty), percentOff = Number(editPercent);
    if (!Number.isInteger(minQtyBoxes) || minQtyBoxes <= 0 || !Number.isInteger(percentOff) || percentOff <= 0 || percentOff > 100) return;
    setPending("edit" + id); setRowErr("");
    const res = await postJson("/api/volume-discounts", { tenantId: ctx.tenantId, id, minQtyBoxes, percentOff }, "PATCH");
    setPending(null);
    if (!res.ok) { setRowErr(res.error === "duplicate" ? "پله‌ای با همین حداقل برای همین سبد/کالا از قبل هست." : actionError(res.status)); return; }
    setEditId(null);
    await load(ctx.tenantId);
  }

  async function removeTier(id: string) {
    setPending("del" + id); setRowErr("");
    const res = await postJson("/api/volume-discounts", { tenantId: ctx.tenantId, id }, "DELETE");
    setPending(null);
    if (!res.ok) { setRowErr(actionError(res.status)); return; }
    await load(ctx.tenantId);
  }

  const priceListName = (id: string | null) => (id ? priceLists.find((l) => l.id === id)?.name ?? "؟" : "همه‌ی سبدها");
  const productLabel = (t: Tier) => (t.variantId ? `${t.productName} (${t.productCode})` : "همه‌ی کالاها");

  // گروه‌بندی برای خوانایی: اول «همه‌ی سبدها»، بعد هر سبدِ نام‌دار به ترتیبِ حروف؛
  // داخلِ هر گروه از کم به زیاد بر اساسِ حداقلِ کارتن — دقیقاً ترتیبی که موتورِ قیمت می‌بیند.
  const groupKeys = [null, ...priceLists.map((l) => l.id)];
  const groups = groupKeys
    .map((key) => ({ key, name: priceListName(key), rows: tiers.filter((t) => t.priceListId === key).sort((a, b) => a.minQtyBoxes - b.minQtyBoxes) }))
    .filter((g) => g.rows.length > 0);

  return (
    <>
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          پله‌ها <strong>جمع نمی‌شوند</strong> — از بینِ همه‌ی پله‌هایی که نمایندگی به حداقلِ کارتنشان
          رسیده، فقط <strong>بیشترین درصد</strong> اعمال می‌شود. «همه‌ی سبدها»/«همه‌ی کالاها» یعنی این
          پله برای هر سبدِ قیمت یا هر کالایی که پله‌ی مشخص‌تری ندارد هم حساب می‌شود.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}

      <h2>افزودنِ پله</h2>
      <div className="card">
        <div className="grid2">
          <div>
            <label htmlFor="vd-pl">سبدِ قیمت</label>
            <select id="vd-pl" value={newPriceListId} onChange={(e) => setNewPriceListId(e.target.value)}>
              <option value={ALL}>همه‌ی سبدها</option>
              {priceLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="vd-var">کالا</label>
            <select id="vd-var" value={newVariantId} onChange={(e) => setNewVariantId(e.target.value)}>
              <option value={ALL}>همه‌ی کالاها</option>
              {variants.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="vd-qty">حداقلِ کارتن</label>
            <input id="vd-qty" type="number" min={1} inputMode="numeric" value={newMinQty} onChange={(e) => setNewMinQty(e.target.value)} />
          </div>
          <div>
            <label htmlFor="vd-pct">درصدِ تخفیف</label>
            <input id="vd-pct" type="number" min={1} max={100} inputMode="numeric" value={newPercent} onChange={(e) => setNewPercent(e.target.value)} />
          </div>
        </div>
        <button className="primary" onClick={createTier} aria-busy={creating}
          disabled={creating || !newMinQty || !newPercent}
          style={{ width: "100%", marginTop: "var(--sp-4)" }}>
          {creating && <span className="spinner" aria-hidden="true" />}افزودنِ پله
        </button>
        {createErr && <div className="err" style={{ marginTop: "var(--sp-2)" }}><Icon name="alert" />{createErr}</div>}
      </div>

      <h2>پله‌های موجود</h2>
      {rowErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{rowErr}</span></div>}
      {loaded && !loadErr && tiers.length === 0 && <p className="empty">هنوز پله‌ای تعریف نشده.</p>}
      {groups.map((g) => (
        <div key={g.key ?? "ALL"} style={{ marginBottom: "var(--sp-4)" }}>
          <h3 className="subtle" style={{ marginBottom: "var(--sp-2)" }}>{g.name}</h3>
          {g.rows.map((t) => (
            <div className="card" key={t.id}>
              {editId === t.id ? (
                <div className="row row--start row--stack-mobile" style={{ gap: "var(--sp-2)" }}>
                  <span className="subtle">{productLabel(t)}</span>
                  <label htmlFor={`eq-${t.id}`} className="sr-only">حداقلِ کارتن</label>
                  <input id={`eq-${t.id}`} type="number" min={1} value={editMinQty} onChange={(e) => setEditMinQty(e.target.value)} style={{ maxWidth: 120 }} />
                  <label htmlFor={`ep-${t.id}`} className="sr-only">درصدِ تخفیف</label>
                  <input id={`ep-${t.id}`} type="number" min={1} max={100} value={editPercent} onChange={(e) => setEditPercent(e.target.value)} style={{ maxWidth: 100 }} />
                  <button className="primary" onClick={() => saveEdit(t.id)} aria-busy={pending === "edit" + t.id} disabled={pending === "edit" + t.id}>
                    {pending === "edit" + t.id && <span className="spinner" aria-hidden="true" />}ذخیره
                  </button>
                  <button className="ghost" onClick={() => setEditId(null)}>انصراف</button>
                </div>
              ) : (
                <div className="row row--start row--stack-mobile" style={{ gap: "var(--sp-2)" }}>
                  <span>{productLabel(t)}</span>
                  <span className="badge">حداقل {n(t.minQtyBoxes)} کارتن</span>
                  <span className="badge badge--ok">{n(t.percentOff)}٪ تخفیف</span>
                  <button className="ghost" onClick={() => startEdit(t)}>ویرایش</button>
                  <DeleteButton pending={pending === "del" + t.id} onConfirm={() => removeTier(t.id)} />
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
