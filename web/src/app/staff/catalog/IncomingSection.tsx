"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../../Icon";
import MessageBanner from "../../MessageBanner";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";
import { formatJalaliDate } from "@/lib/date";
import { JalaliDateInput } from "@/lib/JalaliDateInput";
import { jalaliToDate, todayJalali, type Jalali } from "@/lib/date";

type Item = {
  id: string; variantId: string; name: string; code: string;
  warehouseId: string; warehouseName: string;
  quantityBoxes: number; expectedAt: string;
  source: string; status: "planned" | "confirmed" | "arrived" | "cancelled"; note: string | null;
};
type Variant = { id: string; name: string; code: string; sku: string };
type Wh = { id: string; name: string; code: string };

const n = (v: number) => v.toLocaleString("fa-IR");
const STATUS_FA: Record<string, string> = {
  planned: "برنامه‌ریزی‌شده", confirmed: "قطعی‌شده", arrived: "رسیده", cancelled: "لغوشده",
};
const SOURCE_FA: Record<string, string> = {
  production: "تولید", transfer: "انتقال بین انبار", purchase: "خرید",
};

export default function IncomingSection({ ctx }: { ctx: Ctx }) {
  const [items, setItems] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [whs, setWhs] = useState<Wh[]>([]);
  const [variantId, setVariantId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [qty, setQty] = useState("");
  const [when, setWhen] = useState<Jalali>(todayJalali);
  const [source, setSource] = useState("production");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [loadErr, setLoadErr] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [arriving, setArriving] = useState<string | null>(null); // کارتی که در حالتِ «شماره بچ» است
  const [batch, setBatch] = useState("");

  const load = useCallback(async (tenantId: string) => {
    const [i, cat, w] = await Promise.all([
      getJson<{ items: Item[] }>(`/api/incoming?tenantId=${tenantId}`),
      getJson<{ variants: Variant[] }>(`/api/catalog?tenantId=${tenantId}`),
      getJson<{ warehouses: Wh[] }>(`/api/warehouses?tenantId=${tenantId}`),
    ]);
    if (i.ok) setItems(i.data.items);
    if (cat.ok) setVariants(cat.data.variants);
    if (w.ok) setWhs(w.data.warehouses);
    const failed = [i, cat, w].find((x) => !x.ok);
    setLoadErr(failed && !failed.ok ? loadError(failed.status) : "");
    setLoaded(true);
  }, []);

  useEffect(() => { load(ctx.tenantId); }, [ctx.tenantId, load]);

  async function add() {
    if (!variantId || !warehouseId || Number(qty) <= 0) return;
    setPending("add");
    try {
      const res = await fetch("/api/incoming", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: ctx.tenantId, variantId, warehouseId,
          quantityBoxes: Number(qty),
          // تاریخ به ISO می‌رود چون DB با آن کار می‌کند؛ فقط نمایش شمسی است
          expectedAt: jalaliToDate(when).toISOString().slice(0, 10),
          source, note,
        }),
      });
      setMsg(res.ok ? "ثبت شد." : "ثبت نشد.");
      if (res.ok) { setQty(""); setNote(""); await load(ctx.tenantId); }
    } finally { setPending(null); }
  }

  async function act(id: string, action: "arrive" | "confirm" | "cancel", batchNumber?: string) {
    setPending(id + action); setMsg("");
    try {
      const res = await postJson("/api/incoming",
        { tenantId: ctx.tenantId, id, action, batchNumber }, "PATCH");
      if (!res.ok) { setMsg(actionError(res.status)); await load(ctx.tenantId); return; }
      if (action === "arrive") {
        const d = res.data as { offers?: number; notified?: number };
        // اثرِ رسیدن صریح گفته می‌شود: پشتیبان باید بداند چند نفر از صف نوبت گرفتند
        setMsg(`موجودی وارد شد.${d.offers ? ` ${n(d.offers)} نوبت از صف انتظار پر شد.` : ""}`
          + `${d.notified ? ` ${n(d.notified)} اعلان «موجود شد» صف شد.` : ""}`);
        setArriving(null); setBatch("");
      } else setMsg("انجام شد.");
      await load(ctx.tenantId);
    } finally { setPending(null); }
  }

  return (
    <>
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          محموله‌ی در راه <strong>قابلِ سفارش نیست</strong> و در موجودی شمرده نمی‌شود —
          فقط به نماینده نشان می‌دهد <strong>چقدر و کِی</strong> می‌رسد، تا بین صبر کردن
          و گرفتنِ جایگزین انتخاب کند. با زدنِ <strong>«رسید»</strong> موجودی از مسیرِ
          دفتر حرکات وارد می‌شود و صفِ انتظار همان لحظه جلو می‌رود.
        </span>
      </div>

      {loadErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{loadErr}</span></div>}
      <MessageBanner msg={msg} />

      <h2>ثبت محموله</h2>
      <div className="card">
        <label htmlFor="v">کالا</label>
        <select id="v" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
          <option value="">انتخاب کالا…</option>
          {variants.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
        </select>

        <label htmlFor="w">انبار مقصد</label>
        <select id="w" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">انتخاب انبار…</option>
          {whs.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
        </select>

        <label htmlFor="q">تعداد کارتن</label>
        <input id="q" type="number" min={1} inputMode="numeric" value={qty}
               onChange={(e) => setQty(e.target.value)} style={{ maxWidth: 200 }} />

        <label style={{ marginBottom: 0 }}>تاریخ تقریبی رسیدن</label>
        <JalaliDateInput label="" value={when} onChange={setWhen} currentYear={todayJalali().jy + 1} />

        <label htmlFor="s">منبع</label>
        <select id="s" value={source} onChange={(e) => setSource(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="production">تولید</option>
          <option value="transfer">انتقال بین انبار</option>
          <option value="purchase">خرید</option>
        </select>

        <label htmlFor="nt">توضیح (اختیاری)</label>
        <input id="nt" value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً: بچ تولید مهر" />

        <button className="primary" onClick={add} aria-busy={pending === "add"}
                disabled={pending === "add" || !variantId || !warehouseId || Number(qty) <= 0}
                style={{ width: "100%", marginTop: "var(--sp-4)" }}>
          {pending === "add" && <span className="spinner" aria-hidden="true" />}ثبت محموله
        </button>
      </div>

      <h2>محموله‌های در راه</h2>
      {loaded && !loadErr && items.length === 0 && <p className="empty">محموله‌ی در راهی ثبت نشده.</p>}
      {items.map((i) => (
        <div className="card" key={i.id}>
          <div className="row">
            <strong>{i.name} <span className="subtle">{i.code}</span></strong>
            <span className={`badge ${i.status === "confirmed" ? "badge--ok" : "badge--warn"}`}>
              {STATUS_FA[i.status]}
            </span>
          </div>
          <div className="muted">
            <span className="metric">{n(i.quantityBoxes)}</span> کارتن → {i.warehouseName}
            {" · "}حدودِ {formatJalaliDate(i.expectedAt)}
            {" · "}{SOURCE_FA[i.source] ?? i.source}
          </div>
          {i.note && <div className="subtle">{i.note}</div>}

          {arriving === i.id ? (
            // ورودیِ بچ درون‌کارت، به‌جای window.prompt: هم‌استایل، موبایل‌پسند، و
            // «خالی» با «لغو» اشتباه نمی‌شود (prompt هر دو را "" می‌داد).
            <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
              <label htmlFor={`batch-${i.id}`} className="sr-only">شماره بچ برای {i.name}</label>
              <input id={`batch-${i.id}`} value={batch} onChange={(e) => setBatch(e.target.value)}
                     placeholder="شماره بچ (اختیاری)" style={{ maxWidth: 200 }} autoFocus />
              <button className="primary" onClick={() => act(i.id, "arrive", batch.trim() || undefined)}
                      aria-busy={pending === i.id + "arrive"} disabled={pending === i.id + "arrive"}>
                {pending === i.id + "arrive" && <span className="spinner" aria-hidden="true" />}تأیید رسیدن
              </button>
              <button className="ghost" onClick={() => { setArriving(null); setBatch(""); }}>انصراف</button>
            </div>
          ) : (
            <div className="row row--start row--stack-mobile" style={{ marginTop: "var(--sp-3)" }}>
              <button className="primary" onClick={() => { setArriving(i.id); setBatch(""); }}>رسید</button>
              {i.status === "planned" && (
                <button className="ghost" onClick={() => act(i.id, "confirm")}
                        aria-busy={pending === i.id + "confirm"} disabled={pending === i.id + "confirm"}>
                  قطعی شد
                </button>
              )}
              <button className="danger" onClick={() => act(i.id, "cancel")}
                      aria-busy={pending === i.id + "cancel"} disabled={pending === i.id + "cancel"}>
                لغو
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
