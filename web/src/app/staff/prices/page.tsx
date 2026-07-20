"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getJson, loadError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";

type List = { id: string; name: string; agentCount: number };
type Item = { priceListId: string; variantId: string; price: string; name: string; code: string; sku: string };
type Tier = { id: string; priceListId: string | null; variantId: string | null; minQty: number; percentOff: number; name: string | null };
type Variant = { id: string; name: string; code: string; sku: string };

const money = (v: number) => v.toLocaleString("fa-IR");

export default function PricesPage() {
  const { ctx, state } = useContexts("staff");
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

  useEffect(() => { if (ctx) load(ctx.tenantId); }, [ctx, load]);

  async function save(priceListId: string, variantId: string) {
    if (!ctx) return;
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

  if (state === "none") return <main><p className="err" role="alert">این بخش فقط برای پشتیبان است.</p></main>;
  if (!ctx) return <main><p className="muted">در حال بارگذاری…</p></main>;

  return (
    <main>
      <div className="row"><h1>قیمت‌گذاری</h1><Link href="/staff" className="muted">← پنل</Link></div>
      <p className="muted">{ctx.tenantName} — قیمت‌ها به <strong>ریال</strong> و عددِ صحیح‌اند.</p>
      {loadErr && <div className="card" role="alert"><span className="err">⚠️ {loadErr}</span></div>}

      {loaded && lists.length === 0 && <p className="muted">هنوز لیست قیمتی ساخته نشده.</p>}

      {lists.map((pl) => (
        <div key={pl.id}>
          <h2 style={{ fontSize: "1.05rem", marginTop: "1.25rem" }}>
            {pl.name} <span className="muted">· {pl.agentCount} نمایندگی</span>
          </h2>
          {variants.map((v) => {
            const existing = items.find((i) => i.priceListId === pl.id && i.variantId === v.id);
            const key = pl.id + v.id;
            const val = edit[key] ?? (existing ? String(existing.price) : "");
            return (
              <div className="card" key={v.id}>
                <div className="row">
                  <span>{v.name} <span className="muted">({v.code})</span></span>
                  <span className="muted">
                    {existing ? `${money(Number(existing.price))} ریال` : "بدون قیمت"}
                  </span>
                </div>
                <div className="row" style={{ marginTop: ".5rem", gap: ".5rem", justifyContent: "flex-start" }}>
                  <input type="number" min={0} step={1} inputMode="numeric" placeholder="قیمت (ریال)"
                    aria-label={`قیمت ${v.name}`} value={val} style={{ maxWidth: 180 }}
                    onChange={(e) => setEdit((s) => ({ ...s, [key]: e.target.value }))} />
                  <button onClick={() => save(pl.id, v.id)} disabled={saving === key || val === ""}>
                    {saving === key && <span className="spinner" aria-hidden="true" />}ذخیره
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      <h2 style={{ fontSize: "1.05rem", marginTop: "1.5rem" }}>پله‌های تخفیف حجمی</h2>
      {loaded && tiers.length === 0 && <p className="muted">پله‌ای تعریف نشده.</p>}
      {tiers.map((t) => (
        <div className="card" key={t.id}>
          <div className="row">
            <span>{t.name ?? "همه‌ی کالاها"}</span>
            <span className="muted">از {t.minQty} کارتن → {t.percentOff}٪ تخفیف</span>
          </div>
        </div>
      ))}
    </main>
  );
}
