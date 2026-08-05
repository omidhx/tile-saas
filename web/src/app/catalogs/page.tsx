"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { useContexts, type Ctx } from "@/lib/useContexts";
import ContextSwitcher from "../ContextSwitcher";
import LogoutButton from "../LogoutButton";
import Icon from "../Icon";
import DeleteButton from "../DeleteButton";
import MessageBanner from "../MessageBanner";
import { matches, normalize } from "@/lib/search";

type Item = { variantId: string; customerPrice: number | null };
type Catalog = { id: string; title: string; token: string; isActive: boolean; showDetails: boolean; items: Item[]; createdAt: string };
type Product = { id: string; name: string; code: string };
type Picked = { variantId: string; price: string };

// قیمت را از رشته‌ی کاربر می‌گیرد: ارقامِ فارسی و جداکننده‌ها را پاک می‌کند. خالی → null.
function parsePrice(s: string): number | null {
  const digits = normalize(s).replace(/[^0-9]/g, "");
  return digits ? Number(digits) : null;
}
const money = (v: number) => v.toLocaleString("fa-IR");

export default function CatalogsPage() {
  const { contexts, ctx, state, select } = useContexts("agent");
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [slug, setSlug] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // فرمِ ساخت/ویرایش. editingId = null → ساخت؛ وگرنه ویرایشِ همان کاتالوگ.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [query, setQuery] = useState("");
  const [showDetails, setShowDetails] = useState(false); // توضیحاتِ کامل به مشتری نشان داده شود؟

  const load = useCallback(async (c: Ctx) => {
    const res = await getJson<{ catalogs: Catalog[]; products: Product[]; slug: string | null }>(
      `/api/shared-catalog?tenantId=${c.tenantId}&agentAccountId=${c.agentAccountId}`);
    if (res.ok) {
      setCatalogs(res.data.catalogs);
      setProducts(res.data.products);
      setSlug(res.data.slug ?? "");
      setLoadErr("");
    } else setLoadErr(loadError(res.status));
    setLoaded(true);
  }, []);

  useEffect(() => { if (ctx) load(ctx); }, [ctx, load]);

  const shareUrl = (token: string) => slug ? `${location.origin}/c/${slug}/${token}` : "";

  async function copy(token: string) {
    try { await navigator.clipboard.writeText(shareUrl(token)); setCopied(token); setTimeout(() => setCopied(null), 2000); }
    catch { setMsg({ kind: "err", text: "کپی نشد — لینک را دستی انتخاب کنید." }); }
  }

  const pickIndex = (id: string) => picked.findIndex((p) => p.variantId === id);
  function toggle(id: string) {
    setPicked((s) => pickIndex(id) >= 0 ? s.filter((p) => p.variantId !== id) : [...s, { variantId: id, price: "" }]);
  }
  function setPrice(id: string, price: string) {
    setPicked((s) => s.map((p) => p.variantId === id ? { ...p, price } : p));
  }

  function resetForm() { setEditingId(null); setTitle(""); setPicked([]); setQuery(""); setShowDetails(false); }
  function startEdit(c: Catalog) {
    setEditingId(c.id);
    setTitle(c.title);
    setShowDetails(c.showDetails);
    setPicked(c.items.map((i) => ({ variantId: i.variantId, price: i.customerPrice == null ? "" : String(i.customerPrice) })));
    setQuery(""); setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (!ctx || !title.trim() || picked.length === 0) return;
    const items = picked.map((p) => ({ variantId: p.variantId, customerPrice: parsePrice(p.price) }));
    setPending("save"); setMsg(null);
    const res = editingId
      ? await postJson("/api/shared-catalog",
          { tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId, id: editingId, title, items, showDetails }, "PATCH")
      : await postJson("/api/shared-catalog",
          { tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId, title, items, showDetails });
    setPending(null);
    if (!res.ok) { setMsg({ kind: "err", text: actionError(res.status) }); return; }
    const wasEdit = !!editingId;
    resetForm();
    setMsg({ kind: "ok", text: wasEdit ? "کاتالوگ به‌روز شد." : "کاتالوگ ساخته شد — لینک را برای مشتری بفرستید." });
    await load(ctx);
  }

  async function setActive(id: string, isActive: boolean) {
    if (!ctx) return;
    setPending(id); setMsg(null);
    const res = await postJson("/api/shared-catalog",
      { tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId, id, isActive }, "PATCH");
    setPending(null);
    if (!res.ok) setMsg({ kind: "err", text: actionError(res.status) });
    else await load(ctx);
  }

  async function remove(id: string) {
    if (!ctx) return;
    setPending(id); setMsg(null);
    const res = await postJson("/api/shared-catalog",
      { tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId, id }, "DELETE");
    setPending(null);
    if (!res.ok) setMsg({ kind: "err", text: actionError(res.status) });
    else { if (editingId === id) resetForm(); await load(ctx); }
  }

  if (state === "none")
    return (
      <main>
        <div className="banner banner--error" role="alert">
          <Icon name="alert" /><span>این بخش برای نماینده است.</span>
        </div>
      </main>
    );
  if (!ctx) return <main><p className="muted"><span className="spinner" /> در حال بارگذاری…</p></main>;

  const visible = products.filter((p) => matches(query, [p.name, p.code]));

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>کاتالوگ برای مشتری</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName} — {ctx.agentLegalName}</p>
        </div>
        <nav>
          <ContextSwitcher contexts={contexts} ctx={ctx} onSelect={select} mode="agent" />
          <Link href="/reserve">← موجودی</Link>
          <LogoutButton />
        </nav>
      </div>

      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          محصول‌ها را انتخاب کنید و یک <strong>لینک</strong> بگیرید تا برای مشتری بفرستید.
          برای هر محصول می‌توانید <strong>قیمتِ هر مترمربع</strong> بگذارید (اختیاری) — همانی که
          مشتری می‌بیند، نه قیمتِ خودتان. مشتری بدونِ ورود عکس و مشخصات و <strong>موجود/ناموجود</strong>
          را می‌بیند. لینک را هر وقت خواستید می‌توانید <strong>باطل</strong> کنید.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      <MessageBanner msg={msg} />

      <h2>{editingId ? "ویرایشِ کاتالوگ" : "کاتالوگ جدید"}</h2>
      <div className="card">
        <label htmlFor="ct">عنوان (برای مشتری دیده می‌شود)</label>
        <input id="ct" value={title} onChange={(e) => setTitle(e.target.value)}
               placeholder="مثلاً: پیشنهاد برای پروژه‌ی لابی" />

        <label htmlFor="cq" style={{ marginTop: "var(--sp-4)" }}>
          محصول‌ها <span className="subtle">({picked.length.toLocaleString("fa-IR")} انتخاب‌شده) — قیمتِ هر مترمربع اختیاری است</span>
        </label>
        {products.length > 6 && (
          <input id="cq" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="جستجوی نام یا کد…" style={{ marginBottom: "var(--sp-2)" }} />
        )}
        <div className="pick-list">
          {loaded && products.length === 0 && <p className="empty" style={{ margin: 0 }}>محصولی برای انتخاب نیست.</p>}
          {visible.map((p) => {
            const idx = pickIndex(p.id);
            const on = idx >= 0;
            return (
              <div key={p.id} className="pick-row" style={{ flexWrap: "wrap" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", margin: 0, flex: 1, minWidth: 160, cursor: "pointer", fontWeight: 400 }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.id)} style={{ width: "auto", minHeight: 0 }} />
                  <span>{p.name} <span className="subtle num">{p.code}</span></span>
                </label>
                {on && (
                  <input inputMode="numeric" value={picked[idx].price} onChange={(e) => setPrice(p.id, e.target.value)}
                         placeholder="قیمتِ هر مترمربع (ریال)" aria-label={`قیمتِ هر مترمربع ${p.name}`} style={{ maxWidth: 200 }} />
                )}
              </div>
            );
          })}
        </div>

        <label className="row row--start" style={{ marginTop: "var(--sp-3)", cursor: "pointer", gap: "var(--sp-2)", justifyContent: "flex-start" }}>
          <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)}
                 style={{ width: "auto", minHeight: 0 }} />
          <span>توضیحاتِ کامل (ابعاد، ضخامت، کاربری، متن) هم به مشتری نشان داده شود</span>
        </label>

        <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-4)" }}>
          <button className="primary" onClick={save} aria-busy={pending === "save"}
                  disabled={pending === "save" || !title.trim() || picked.length === 0}>
            {pending === "save" && <span className="spinner" aria-hidden="true" />}
            {editingId ? "ذخیره‌ی تغییرات" : "ساختِ کاتالوگ و گرفتنِ لینک"}
          </button>
          {editingId && <button className="ghost" onClick={resetForm}>انصراف</button>}
        </div>
      </div>

      <h2>کاتالوگ‌های من</h2>
      {loaded && !loadErr && catalogs.length === 0 && <p className="empty">هنوز کاتالوگی نساخته‌اید.</p>}
      {catalogs.map((c) => {
        const priced = c.items.filter((i) => i.customerPrice != null).length;
        return (
          <div className="card" key={c.id}>
            <div className="row">
              <span>
                <strong>{c.title}</strong>{" "}
                <span className="subtle">{c.items.length.toLocaleString("fa-IR")} محصول</span>
                {priced > 0 && <span className="subtle"> · {money(priced)} قیمت‌دار</span>}
                {!c.isActive && <span className="badge badge--warn" style={{ marginInlineStart: "var(--sp-2)" }}>باطل‌شده</span>}
              </span>
              <span className="row row--start">
                <button className="ghost" disabled={pending === c.id} onClick={() => startEdit(c)}>ویرایش</button>
                <button className="ghost" disabled={pending === c.id} onClick={() => setActive(c.id, !c.isActive)}>
                  {c.isActive ? "باطل کن" : "فعال کن"}
                </button>
                <DeleteButton pending={pending === c.id} onConfirm={() => remove(c.id)} />
              </span>
            </div>
            {c.isActive && (
              <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
                <input readOnly value={shareUrl(c.token)} aria-label="لینک اشتراک"
                       onFocus={(e) => e.target.select()} style={{ flex: 1, direction: "ltr" }} />
                <button onClick={() => copy(c.token)}>{copied === c.token ? "کپی شد ✓" : "کپیِ لینک"}</button>
              </div>
            )}
          </div>
        );
      })}
    </main>
  );
}
