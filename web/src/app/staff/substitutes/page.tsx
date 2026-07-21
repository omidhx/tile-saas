"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import NavMenu from "../../NavMenu";
import { getJson, loadError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";

type Item = {
  id: string; variantId: string; variantName: string; variantCode: string;
  substituteVariantId: string; substituteName: string; substituteCode: string; note: string | null;
};
type Variant = { id: string; name: string; code: string; sku: string };

export default function SubstitutesPage() {
  const { ctx, state } = useContexts("staff");
  const [items, setItems] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [msg, setMsg] = useState("");
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (tenantId: string) => {
    const [s, cat] = await Promise.all([
      getJson<{ items: Item[] }>(`/api/substitutes?tenantId=${tenantId}`),
      getJson<{ variants: Variant[] }>(`/api/catalog?tenantId=${tenantId}`),
    ]);
    if (s.ok) setItems(s.data.items);
    if (cat.ok) setVariants(cat.data.variants);
    const failed = [s, cat].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, []);

  useEffect(() => { if (ctx) load(ctx.tenantId); }, [ctx, load]);

  async function add() {
    if (!ctx || !from || !to || from === to) return;
    setPending("add");
    try {
      const res = await fetch("/api/substitutes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ctx.tenantId, variantId: from, substituteVariantId: to, note }),
      });
      setMsg(res.ok ? "ثبت شد." : "ثبت نشد.");
      if (res.ok) { setNote(""); setTo(""); await load(ctx.tenantId); }
    } finally { setPending(null); }
  }

  async function remove(id: string) {
    if (!ctx) return;
    setPending(id);
    try {
      await fetch("/api/substitutes", {
        method: "DELETE", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: ctx.tenantId, id }),
      });
      await load(ctx.tenantId);
    } finally { setPending(null); }
  }

  if (state === "none")
    return (
      <main>
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>این بخش فقط برای پشتیبان است.</span>
        </div>
      </main>
    );
  if (!ctx) return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;

  const label = (v: Variant) => `${v.name} (${v.code})`;

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>کالای جایگزین</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu /></nav>
      </div>

      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          وقتی کالایی ناموجود است، این جایگزین‌ها به نماینده پیشنهاد می‌شوند —
          <strong> فقط آن‌هایی که خودشان موجود باشند</strong>.
          «همان کالا با درجه‌ی دیگر» خودکار پیشنهاد می‌شود و لازم نیست اینجا ثبتش کنید.
          رابطه <strong>یک‌طرفه</strong> است: اگر «الف → ب» تعریف کنید، برعکسش اعمال نمی‌شود.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      {msg && <div className="banner banner--ok" role="status"><Icon name="check" /><span>{msg}</span></div>}

      <h2>افزودن جایگزین</h2>
      <div className="card">
        <label htmlFor="from">وقتی این کالا نبود…</label>
        <select id="from" value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">انتخاب کالا…</option>
          {variants.map((v) => <option key={v.id} value={v.id}>{label(v)}</option>)}
        </select>

        <label htmlFor="to">…این را پیشنهاد بده</label>
        <select id="to" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">انتخاب کالا…</option>
          {variants.filter((v) => v.id !== from).map((v) => <option key={v.id} value={v.id}>{label(v)}</option>)}
        </select>

        <label htmlFor="note">توضیح برای نماینده (اختیاری)</label>
        <input id="note" value={note} onChange={(e) => setNote(e.target.value)}
               placeholder="مثلاً: همان اندازه، لعاب مات" />

        <button className="primary" onClick={add} aria-busy={pending === "add"}
                disabled={pending === "add" || !from || !to}
                style={{ width: "100%", marginTop: "var(--sp-4)" }}>
          {pending === "add" && <span className="spinner" aria-hidden="true" />}افزودن
        </button>
      </div>

      <h2>جایگزین‌های تعریف‌شده</h2>
      {loaded && !loadErr && items.length === 0 && (
        <p className="empty">
          هنوز جایگزینی تعریف نشده — فعلاً فقط «همان کالا با درجه‌ی دیگر» پیشنهاد می‌شود.
        </p>
      )}
      {items.map((i) => (
        <div className="card" key={i.id}>
          <div className="row">
            <span>
              <strong>{i.variantName}</strong> <span className="subtle">{i.variantCode}</span>
              <span className="muted"> ← </span>
              <strong>{i.substituteName}</strong> <span className="subtle">{i.substituteCode}</span>
            </span>
            <button className="danger" onClick={() => remove(i.id)}
                    aria-busy={pending === i.id} disabled={pending === i.id}>
              {pending === i.id && <span className="spinner" aria-hidden="true" />}حذف
            </button>
          </div>
          {i.note && <div className="subtle">{i.note}</div>}
        </div>
      ))}
    </main>
  );
}
