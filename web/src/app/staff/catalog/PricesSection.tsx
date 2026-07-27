"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../../Icon";
import { getJson, loadError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";

type List = { id: string; name: string; agentCount: number };
type Item = { priceListId: string; variantId: string; price: string; name: string; code: string; sku: string };
type Tier = { id: string; priceListId: string | null; variantId: string | null; minQty: number; percentOff: number; name: string | null };
type Variant = { id: string; name: string; code: string; sku: string };

const money = (v: number) => v.toLocaleString("fa-IR");

export default function PricesSection({ ctx }: { ctx: Ctx }) {
  const [lists, setLists] = useState<List[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async (tenantId: string) => {
    const [p, cat] = await Promise.all([
      getJson<{ lists: List[]; items: Item[]; tiers: Tier[] }>(`/api/prices?tenantId=${tenantId}`),
      getJson<{ variants: Variant[] }>(`/api/catalog?tenantId=${tenantId}`),
    ]);
    if (p.ok) { setLists(p.data.lists); setItems(p.data.items); setTiers(p.data.tiers); }
    if (cat.ok) setVariants(cat.data.variants);
    const failed = [p, cat].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, []);

  useEffect(() => { load(ctx.tenantId); }, [ctx.tenantId, load]);

  async function save(priceListId: string, variantId: string) {
    const key = priceListId + variantId;
    const raw = edit[key];
    const price = Number(raw);
    if (!Number.isInteger(price) || price < 0) { setLoadErr("قیمت باید عددِ صحیحِ نامنفی باشد (ریال)."); return; }
    setSaving(key);
    try {
      const res = await fetch("/api/prices", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ctx.tenantId, priceListId, variantId, price }),
      });
      if (!res.ok) { setLoadErr(`ذخیره ناموفق (${res.status})`); return; }
      setEdit((e) => { const n = { ...e }; delete n[key]; return n; });
      await load(ctx.tenantId);
    } finally { setSaving(null); }
  }

  return (
    <>
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          قیمت‌ها به <strong>ریال</strong> و عددِ صحیح‌اند. قیمتِ ثبت‌نشده یعنی
          «قیمت ندارد» — نه رایگان: چنین کالایی هرگز خودکار تأیید نمی‌شود و در گزارش
          به‌عنوان «خطِ بی‌قیمت» شمرده می‌شود.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}

      {loaded && lists.length === 0 && <p className="empty">هنوز لیست قیمتی ساخته نشده.</p>}

      {lists.map((pl) => {
        const priced = variants.filter((v) => items.some((i) => i.priceListId === pl.id && i.variantId === v.id)).length;
        return (
          <div key={pl.id}>
            <h2>
              {pl.name}
              <span className="badge">{money(pl.agentCount)} نمایندگی</span>
              {/* پوششِ قیمت: کالای بی‌قیمت پیامدِ واقعی دارد، پس شمارشش دیده می‌شود */}
              <span className={`badge${priced === variants.length ? " badge--ok" : " badge--warn"}`}>
                {money(priced)} از {money(variants.length)} کالا قیمت دارد
              </span>
            </h2>
            {variants.map((v) => {
              const existing = items.find((i) => i.priceListId === pl.id && i.variantId === v.id);
              const key = pl.id + v.id;
              const val = edit[key] ?? (existing ? String(existing.price) : "");
              const dirty = edit[key] !== undefined && edit[key] !== (existing ? String(existing.price) : "");
              return (
                <div className="card" key={v.id}>
                  <div className="row">
                    <span><strong>{v.name}</strong> <span className="subtle">{v.code}</span></span>
                    {existing
                      ? <span className="metric">{money(Number(existing.price))} ریال</span>
                      : <span className="badge badge--warn">بدون قیمت</span>}
                  </div>
                  <div className="row row--start" style={{ marginTop: "var(--sp-3)" }}>
                    <label htmlFor={`p-${key}`} className="sr-only">قیمت {v.name} در {pl.name}</label>
                    <input id={`p-${key}`} type="number" min={0} step={1} inputMode="numeric" placeholder="قیمت (ریال)"
                      value={val} style={{ maxWidth: 200 }}
                      onChange={(e) => setEdit((s) => ({ ...s, [key]: e.target.value }))} />
                    <button onClick={() => save(pl.id, v.id)} aria-busy={saving === key}
                      className={dirty ? "primary" : undefined}
                      disabled={saving === key || val === "" || !dirty}>
                      {saving === key && <span className="spinner" aria-hidden="true" />}
                      {dirty ? "ذخیره" : "ذخیره شده"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      <h2>پله‌های تخفیف حجمی</h2>
      {loaded && tiers.length === 0
        ? <p className="empty">پله‌ای تعریف نشده — تخفیف حجمی اعمال نمی‌شود.</p>
        : tiers.map((t) => (
            <div className="card" key={t.id}>
              <div className="row">
                <span>{t.name ?? <span className="muted">همه‌ی کالاها</span>}</span>
                <span>
                  <span className="muted">از {money(t.minQty)} کارتن → </span>
                  <span className="metric">{money(t.percentOff)}٪</span> <span className="muted">تخفیف</span>
                </span>
              </div>
            </div>
          ))}
      {tiers.length > 0 && (
        <p className="subtle">
          افزودن/ویرایشِ پله فعلاً با SQL انجام می‌شود؛ این فهرست فقط خواندنی است.
        </p>
      )}
    </>
  );
}
