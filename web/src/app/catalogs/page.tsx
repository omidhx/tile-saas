"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { useContexts, type Ctx } from "@/lib/useContexts";
import ContextSwitcher from "../ContextSwitcher";
import LogoutButton from "../LogoutButton";
import Icon from "../Icon";
import { matches } from "@/lib/search";

type Catalog = { id: string; title: string; token: string; isActive: boolean; itemCount: number; createdAt: string };
type Product = { id: string; name: string; code: string };

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

  // فرمِ ساخت
  const [title, setTitle] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

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

  const shareUrl = (token: string) =>
    slug ? `${location.origin}/c/${slug}/${token}` : "";

  async function copy(token: string) {
    try { await navigator.clipboard.writeText(shareUrl(token)); setCopied(token); setTimeout(() => setCopied(null), 2000); }
    catch { setMsg({ kind: "err", text: "کپی نشد — لینک را دستی انتخاب کنید." }); }
  }

  function toggle(id: string) {
    setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function create() {
    if (!ctx || !title.trim() || picked.size === 0) return;
    setPending("create"); setMsg(null);
    const res = await postJson("/api/shared-catalog", {
      tenantId: ctx.tenantId, agentAccountId: ctx.agentAccountId,
      title, variantIds: [...picked],
    });
    setPending(null);
    if (!res.ok) { setMsg({ kind: "err", text: actionError(res.status) }); return; }
    setTitle(""); setPicked(new Set()); setQuery("");
    setMsg({ kind: "ok", text: "کاتالوگ ساخته شد — لینک را برای مشتری بفرستید." });
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
    else await load(ctx);
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
          مشتری بدونِ ورود، عکس و مشخصات و <strong>موجود/ناموجود</strong> را می‌بیند —
          نه قیمت و نه عددِ موجودی. لینک را هر وقت خواستید می‌توانید <strong>باطل</strong> کنید.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      {msg && (
        <div className={`banner banner--${msg.kind === "ok" ? "ok" : "error"}`} role="status">
          <Icon name={msg.kind === "ok" ? "check" : "alert"} /><span>{msg.text}</span>
        </div>
      )}

      <h2>کاتالوگ جدید</h2>
      <div className="card">
        <label htmlFor="ct">عنوان (برای مشتری دیده می‌شود)</label>
        <input id="ct" value={title} onChange={(e) => setTitle(e.target.value)}
               placeholder="مثلاً: پیشنهاد برای پروژه‌ی لابی" />

        <label htmlFor="cq" style={{ marginTop: "var(--sp-4)" }}>
          محصول‌ها <span className="subtle">({picked.size.toLocaleString("fa-IR")} انتخاب‌شده)</span>
        </label>
        {products.length > 6 && (
          <input id="cq" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="جستجوی نام یا کد…" style={{ marginBottom: "var(--sp-2)" }} />
        )}
        <div className="pick-list">
          {loaded && products.length === 0 && <p className="empty" style={{ margin: 0 }}>محصولی برای انتخاب نیست.</p>}
          {visible.map((p) => (
            <label key={p.id} className="pick-row">
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)}
                     style={{ width: "auto", minHeight: 0 }} />
              <span>{p.name} <span className="subtle num">{p.code}</span></span>
            </label>
          ))}
        </div>

        <button className="primary" onClick={create} aria-busy={pending === "create"}
                disabled={pending === "create" || !title.trim() || picked.size === 0}
                style={{ width: "100%", marginTop: "var(--sp-4)" }}>
          {pending === "create" && <span className="spinner" aria-hidden="true" />}ساختِ کاتالوگ و گرفتنِ لینک
        </button>
      </div>

      <h2>کاتالوگ‌های من</h2>
      {loaded && !loadErr && catalogs.length === 0 && <p className="empty">هنوز کاتالوگی نساخته‌اید.</p>}
      {catalogs.map((c) => (
        <div className="card" key={c.id}>
          <div className="row">
            <span>
              <strong>{c.title}</strong>{" "}
              <span className="subtle">{c.itemCount.toLocaleString("fa-IR")} محصول</span>
              {!c.isActive && <span className="badge badge--warn" style={{ marginInlineStart: ".4rem" }}>باطل‌شده</span>}
            </span>
            <span className="row row--start">
              <button className="ghost" disabled={pending === c.id}
                      onClick={() => setActive(c.id, !c.isActive)}>
                {c.isActive ? "باطل کن" : "فعال کن"}
              </button>
              <button className="danger" disabled={pending === c.id} onClick={() => remove(c.id)}>حذف</button>
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
      ))}
    </main>
  );
}
