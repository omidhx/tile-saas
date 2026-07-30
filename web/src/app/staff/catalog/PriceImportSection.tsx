"use client";
import { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import Icon from "../../Icon";
import { getJson, postJson, loadError, actionError } from "@/lib/api";
import type { Ctx } from "@/lib/useContexts";

const n = (v: number) => v.toLocaleString("fa-IR");

type PriceList = { id: string; name: string; agentCount: number };
type Row = { sku: string; price: number };
type Result = { applied: number; errors: { row: number; reason: string; detail?: string }[] };

// انتخابِ ستون بر اساس نام هدر (fa/en، case-insensitive) — همان الگوی ImportSection
const pick = (o: Record<string, unknown>, names: string[]) => {
  for (const k of Object.keys(o)) if (names.includes(k.trim().toLowerCase())) return o[k];
  return undefined;
};

/**
 * ورودِ اکسلِ قیمت برای یک سبد — تا حالا هر قیمت باید تک‌به‌تک روی کارتِ خودِ
 * محصول ثبت می‌شد (ده‌ها بار باز/بسته‌کردنِ پنل). این‌جا مثلِ «ورود از اکسل»ِ
 * موجودی است، ولی خطرِ آن را ندارد: فقط upsert می‌کند، چیزی را صفر نمی‌کند —
 * کالایی که در فایل نباشد دست‌نخورده می‌ماند.
 */
export default function PriceImportSection({ ctx }: { ctx: Ctx }) {
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [listErr, setListErr] = useState("");
  const [priceListId, setPriceListId] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createErr, setCreateErr] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [skipped, setSkipped] = useState(0);
  const [parseErr, setParseErr] = useState("");
  const [pending, setPending] = useState(false);
  const [submitErr, setSubmitErr] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  const loadLists = useCallback(async () => {
    const r = await getJson<{ lists: PriceList[] }>(`/api/prices?tenantId=${ctx.tenantId}`);
    if (r.ok) setPriceLists(r.data.lists);
    else setListErr(loadError(r.status));
  }, [ctx.tenantId]);
  useEffect(() => { loadLists(); }, [loadLists]);

  async function createList() {
    if (!newName.trim()) return;
    setCreating(true); setCreateErr("");
    const res = await postJson("/api/price-lists", { tenantId: ctx.tenantId, name: newName.trim() });
    setCreating(false);
    if (!res.ok) { setCreateErr(actionError(res.status)); return; }
    setNewName("");
    await loadLists();
    setPriceListId((res.data as { list: { id: string } }).list.id);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseErr(""); setResult(null); setSubmitErr(""); setSkipped(0);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
      const all: Row[] = json.map((o) => ({
        sku: String(pick(o, ["sku", "کد", "code"]) ?? "").trim(),
        price: Math.trunc(Number(pick(o, ["price", "قیمت", "unit_price"]) ?? NaN)),
      }));
      const valid = all.filter((r) => r.sku);
      setSkipped(all.length - valid.length);
      setRows(valid);
    } catch {
      setParseErr("خواندن فایل ناموفق بود. یک .xlsx معتبر انتخاب کن.");
    }
  }

  async function submit() {
    if (!priceListId || rows.length === 0) return;
    setPending(true); setSubmitErr(""); setResult(null);
    const res = await postJson("/api/prices/import", { tenantId: ctx.tenantId, priceListId, rows });
    setPending(false);
    if (!res.ok) { setSubmitErr(actionError(res.status)); return; }
    setResult(res.data as Result);
  }

  const ready = !!priceListId && rows.length > 0;
  const listName = priceLists.find((l) => l.id === priceListId)?.name;

  return (
    <>
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          فقط قیمتِ کالاهایی که در فایل هستند تغییر می‌کند — بقیه دست‌نخورده می‌مانند
          (برخلافِ ورودِ موجودی، این یک Snapshot نیست). فایل در مرورگر خوانده
          می‌شود و فقط ردیف‌ها به سرور می‌روند.
        </span>
      </div>

      <h2>۱. سبدِ قیمت‌گذاری</h2>
      {listErr && <div className="banner banner--error" role="alert"><Icon name="alert" /><span>{listErr}</span></div>}
      <div className="card">
        <label htmlFor="pl">سبدِ مقصد</label>
        <select id="pl" value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
          <option value="">انتخاب…</option>
          {priceLists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>

        <label htmlFor="npl" style={{ marginTop: "var(--sp-3)" }}>یا ساختِ سبدِ تازه</label>
        <div className="row row--start">
          <input id="npl" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="مثلاً: لیستِ ۱۴۰۵" />
          <button onClick={createList} aria-busy={creating} disabled={creating || !newName.trim()}>
            {creating && <span className="spinner" aria-hidden="true" />}ساخت
          </button>
        </div>
        {createErr && <div className="err" style={{ marginTop: "var(--sp-2)" }}><Icon name="alert" />{createErr}</div>}
      </div>

      <h2>۲. فایل</h2>
      <div className="card">
        <label htmlFor="xl">فایل اکسل — ستون‌ها: sku، قیمت (ریال، عددِ صحیح)</label>
        <input id="xl" type="file" accept=".xlsx,.xls" onChange={onFile} />
        {fileName && <div className="subtle" style={{ marginTop: "var(--sp-2)" }}>{fileName}</div>}
        {parseErr && <div className="err" style={{ marginTop: "var(--sp-2)" }}><Icon name="alert" />{parseErr}</div>}
        {rows.length > 0 && (
          <div className="row row--start" style={{ marginTop: "var(--sp-2)" }}>
            <span className="badge badge--ok"><Icon name="check" size={13} />{n(rows.length)} ردیفِ معتبر</span>
            {skipped > 0 && <span className="badge badge--warn">{n(skipped)} ردیف بدونِ sku نادیده گرفته شد</span>}
          </div>
        )}
      </div>

      <h2>۳. اعمال</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {ready
            ? <>{n(rows.length)} ردیف روی سبدِ <strong>{listName}</strong> اعمال می‌شود.</>
            : rows.length === 0 ? "اول فایل را انتخاب کنید." : "سبدِ قیمت‌گذاری را انتخاب کنید."}
        </p>
        <button className="primary" onClick={submit} disabled={pending || !ready} aria-busy={pending}>
          {pending && <span className="spinner" aria-hidden="true" />}
          {pending ? "در حال اعمال…" : "اعمالِ قیمت‌ها"}
        </button>
        {submitErr && (
          <div className="banner banner--error" role="alert" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
            <Icon name="alert" /><span>{submitErr}</span>
          </div>
        )}
      </div>

      {result && (
        <>
          <h2>نتیجه</h2>
          <div className={`banner banner--${result.errors.length > 0 ? "warn" : "ok"}`} role="status">
            <Icon name={result.errors.length > 0 ? "alert" : "check"} /><span>اعمال شد.</span>
          </div>
          <div className="card">
            <div className="row row--start" style={{ gap: "var(--sp-4)" }}>
              <span><span className="metric">{n(result.applied)}</span> <span className="muted">قیمتِ تغییرکرده</span></span>
              <span><span className="metric">{n(result.errors.length)}</span> <span className="muted">خطا</span></span>
            </div>
            {result.errors.length > 0 && (
              <ul className="muted" style={{ marginBottom: 0 }}>
                {result.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>ردیف {e.row}: {e.reason}{e.detail ? ` (${e.detail})` : ""}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
}
