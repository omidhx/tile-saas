"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Icon from "../../Icon";
import MessageBanner from "../../MessageBanner";
import NavMenu from "../../NavMenu";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";
import { matches } from "@/lib/search";

type Item = {
  id: string; variantId: string; variantName: string; variantCode: string;
  substituteVariantId: string; substituteName: string; substituteCode: string; note: string | null;
};
type Variant = { id: string; name: string; code: string; sku: string };
type Group = { variantId: string; name: string; code: string; subs: Item[] };

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
  // ویرایشِ درجای توضیحِ یک جایگزین (یکی در هر لحظه)
  const [edit, setEdit] = useState<{ id: string; note: string } | null>(null);
  // افزودنِ جایگزینِ دیگر به یک محصول، بدونِ برگشتن به فرمِ بالا
  const [addFor, setAddFor] = useState<string | null>(null);
  const [addTo, setAddTo] = useState("");
  const [addNote, setAddNote] = useState("");
  const [addQuery, setAddQuery] = useState("");

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

  /** ثبت یا به‌روزکردنِ توضیح — POST همان جفت، upsert در بک‌اند توضیح را عوض می‌کند. */
  async function upsert(variantId: string, substituteVariantId: string, noteVal: string, key: string) {
    if (!ctx) return false;
    setPending(key); setMsg("");
    const res = await postJson("/api/substitutes",
      { tenantId: ctx.tenantId, variantId, substituteVariantId, note: noteVal });
    setPending(null);
    if (!res.ok) { setMsg(actionError(res.status)); return false; }
    await load(ctx.tenantId);
    return true;
  }

  async function add() {
    if (!ctx || !from || !to || from === to) return;
    if (await upsert(from, to, note, "add")) { setNote(""); setTo(""); setFrom(""); setMsg("ثبت شد."); }
  }

  async function saveNote() {
    if (!edit) return;
    const i = items.find((x) => x.id === edit.id);
    if (!i) return;
    if (await upsert(i.variantId, i.substituteVariantId, edit.note, "note" + edit.id)) {
      setEdit(null); setMsg("ثبت شد.");
    }
  }

  async function addInGroup(variantId: string) {
    if (!addTo) return;
    if (await upsert(variantId, addTo, addNote, "g" + variantId)) {
      setAddTo(""); setAddNote(""); setAddQuery(""); setAddFor(null); setMsg("ثبت شد.");
    }
  }

  async function remove(id: string) {
    if (!ctx) return;
    setPending(id); setMsg("");
    const res = await postJson("/api/substitutes", { tenantId: ctx.tenantId, id }, "DELETE");
    setPending(null);
    if (!res.ok) setMsg(actionError(res.status));
    else await load(ctx.tenantId);
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

  // گروه‌بندی بر اساس محصولِ مبدأ — items از قبل بر نامِ مبدأ مرتب است، پس گروه‌ها هم مرتب می‌آیند
  const groups: Group[] = [];
  const byVariant = new Map<string, Group>();
  for (const i of items) {
    let g = byVariant.get(i.variantId);
    if (!g) { g = { variantId: i.variantId, name: i.variantName, code: i.variantCode, subs: [] }; byVariant.set(i.variantId, g); groups.push(g); }
    g.subs.push(i);
  }

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
          هر محصول می‌تواند <strong>چند جایگزین</strong> داشته باشد؛ توضیحِ هرکدام هم قابلِ ویرایش است.
          «همان کالا با درجه‌ی دیگر» خودکار پیشنهاد می‌شود و لازم نیست اینجا ثبتش کنید.
          رابطه <strong>یک‌طرفه</strong> است: اگر «الف → ب» تعریف کنید، برعکسش اعمال نمی‌شود.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      <MessageBanner msg={msg} />

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
               placeholder="مثلاً: همان اندازه, لعاب مات" />

        <button className="primary" onClick={add} aria-busy={pending === "add"}
                disabled={pending === "add" || !from || !to}
                style={{ width: "100%", marginTop: "var(--sp-4)" }}>
          {pending === "add" && <span className="spinner" aria-hidden="true" />}افزودن
        </button>
      </div>

      <h2>جایگزین‌های تعریف‌شده</h2>
      {loaded && !loadErr && groups.length === 0 && (
        <p className="empty">
          هنوز جایگزینی تعریف نشده — فعلاً فقط «همان کالا با درجه‌ی دیگر» پیشنهاد می‌شود.
        </p>
      )}

      {groups.map((g) => {
        // نامزدهای افزودن: هر واریانتِ دیگری که در این گروه هنوز جایگزین نشده، فیلترشده با جستجو
        const chosen = new Set(g.subs.map((s) => s.substituteVariantId));
        const cands = variants.filter((v) => v.id !== g.variantId && !chosen.has(v.id)
          && matches(addQuery, [v.name, v.code]));
        return (
          <div className="card" key={g.variantId}>
            <div className="row">
              <span><strong>{g.name}</strong> <span className="subtle num">{g.code}</span></span>
              <span className="subtle">{g.subs.length.toLocaleString("fa-IR")} جایگزین</span>
            </div>

            {g.subs.map((i) => (
              <div key={i.id} style={{ marginTop: "var(--sp-2)", paddingTop: "var(--sp-2)", borderTop: "1px solid var(--line)" }}>
                <div className="row">
                  <span>
                    <span className="muted">← </span>
                    <strong>{i.substituteName}</strong> <span className="subtle num">{i.substituteCode}</span>
                  </span>
                  <span className="row row--start">
                    <button className="ghost" onClick={() => setEdit(edit?.id === i.id ? null : { id: i.id, note: i.note ?? "" })}>
                      {edit?.id === i.id ? "بستن" : "ویرایش توضیح"}
                    </button>
                    <button className="danger" onClick={() => remove(i.id)}
                            aria-busy={pending === i.id} disabled={pending === i.id}>
                      {pending === i.id && <span className="spinner" aria-hidden="true" />}حذف
                    </button>
                  </span>
                </div>
                {edit?.id === i.id ? (
                  <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-2)" }}>
                    <input value={edit.note} onChange={(e) => setEdit({ id: i.id, note: e.target.value })}
                           placeholder="توضیح برای نماینده" aria-label="توضیح جایگزین" style={{ maxWidth: 260 }} />
                    <button className="primary" onClick={saveNote} disabled={pending === "note" + i.id}>
                      {pending === "note" + i.id && <span className="spinner" aria-hidden="true" />}ذخیره
                    </button>
                    <button className="ghost" onClick={() => setEdit(null)}>انصراف</button>
                  </div>
                ) : i.note ? <div className="subtle">{i.note}</div> : null}
              </div>
            ))}

            {/* افزودنِ جایگزینِ دیگر به همین محصول — تا یک محصول به چند تای دیگر جایگزین شود */}
            <div style={{ marginTop: "var(--sp-3)", paddingTop: "var(--sp-2)", borderTop: "1px solid var(--line)" }}>
              {addFor === g.variantId ? (
                <div className="row row--start row--stack-mobile">
                  <input type="search" value={addQuery} onChange={(e) => setAddQuery(e.target.value)}
                         placeholder="جستجوی نام یا کد…" aria-label="جستجوی جایگزین" style={{ maxWidth: 180 }} />
                  <select value={addTo} onChange={(e) => setAddTo(e.target.value)} aria-label="کالای جایگزین" style={{ maxWidth: 240 }}>
                    <option value="">{cands.length ? "انتخاب جایگزین…" : "موردی یافت نشد"}</option>
                    {cands.map((v) => <option key={v.id} value={v.id}>{label(v)}</option>)}
                  </select>
                  <input value={addNote} onChange={(e) => setAddNote(e.target.value)}
                         placeholder="توضیح (اختیاری)" aria-label="توضیح جایگزین" style={{ maxWidth: 200 }} />
                  <button className="primary" onClick={() => addInGroup(g.variantId)}
                          disabled={pending === "g" + g.variantId || !addTo}>
                    {pending === "g" + g.variantId && <span className="spinner" aria-hidden="true" />}افزودن
                  </button>
                  <button className="ghost" onClick={() => { setAddFor(null); setAddTo(""); setAddNote(""); setAddQuery(""); }}>انصراف</button>
                </div>
              ) : (
                <button className="ghost" onClick={() => { setAddFor(g.variantId); setAddTo(""); setAddNote(""); setAddQuery(""); }}>
                  + افزودن جایگزینِ دیگر
                </button>
              )}
            </div>
          </div>
        );
      })}
    </main>
  );
}
