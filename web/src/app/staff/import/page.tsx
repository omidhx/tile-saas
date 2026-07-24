"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import Icon from "../../Icon";
import { hasPageAccess } from "@/lib/staffPages";
import NavMenu from "../../NavMenu";
import { getJson, loadError } from "@/lib/api";
import { useContexts } from "@/lib/useContexts";

const n = (v: number) => v.toLocaleString("fa-IR");

type Wh = { id: string; name: string; code: string };
type Row = { sku: string; warehouseCode: string; batchNumber: string | null; shadeCode: string | null; caliberCode: string | null; onHand: number; imageUrl: string | null; name: string | null; color: string | null; glaze: string | null; punch: string | null; body: string | null };
type Result = { applied: number; zeroed: number; deduped: boolean; errors: { row: number | null; reason: string; detail?: string }[] };

// انتخابِ ستون بر اساس نام هدر (fa/en، case-insensitive)
const pick = (o: Record<string, unknown>, names: string[]) => {
  for (const k of Object.keys(o)) if (names.includes(k.trim().toLowerCase())) return o[k];
  return undefined;
};
const s = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());

export default function ImportPage() {
  const { ctx, state } = useContexts("staff");
  const [warehouses, setWarehouses] = useState<Wh[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [scopeType, setScopeType] = useState<"tenant" | "warehouse">("warehouse");
  const [scopeWh, setScopeWh] = useState("");
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState("");
  const [skipped, setSkipped] = useState(0);
  const [whErr, setWhErr] = useState("");

  useEffect(() => {
    if (!ctx) return;
    (async () => {
      const w = await getJson<{ warehouses: Wh[] }>(`/api/warehouses?tenantId=${ctx.tenantId}`);
      // شکستِ خاموش اینجا فقط آزاردهنده نیست، **خطرناک** است: کاربری که نمی‌تواند
      // انبار انتخاب کند طبیعتاً دامنه را روی «کل کارخانه» می‌گذارد تا جلو برود —
      // یعنی همان گزینه‌ای که موجودیِ همه‌ی انبارها را صفر می‌کند.
      if (w.ok) setWarehouses(w.data.warehouses);
      else setWhErr(loadError(w.status));
    })();
  }, [ctx]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(""); setResult(null); setSkipped(0);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
      const all: Row[] = json.map((o) => ({
        sku: String(pick(o, ["sku", "کد", "code"]) ?? "").trim(),
        warehouseCode: String(pick(o, ["warehouse", "انبار", "wh", "code_wh"]) ?? "").trim(),
        batchNumber: s(pick(o, ["batch", "بچ", "batch_number", "بچ‌نامبر"])),
        shadeCode: s(pick(o, ["shade", "شید"])),
        caliberCode: s(pick(o, ["caliber", "کالیبر"])),
        onHand: Math.trunc(Number(pick(o, ["on_hand", "onhand", "موجودی", "قابل‌سفارش", "count", "qty"]) ?? 0)),
        imageUrl: s(pick(o, ["image", "عکس", "image_url", "تصویر", "img"])),
        // v2 ساختِ خودکار: اگر ستونِ نام بود و sku ناموجود، محصول ساخته می‌شود
        name: s(pick(o, ["name", "نام", "محصول", "title"])),
        color: s(pick(o, ["color", "رنگ"])),
        glaze: s(pick(o, ["glaze", "لعاب"])),
        punch: s(pick(o, ["punch", "پانچ"])),
        body: s(pick(o, ["body", "بدنه"])),
      }));
      const parsed = all.filter((r) => r.sku && r.warehouseCode);
      // ردیف‌های بدونِ sku/انبار بی‌سروصدا کنار گذاشته می‌شدند. در یک snapshot این
      // خطرناک است: ردیفی که خوانده نشود «غایب» حساب می‌شود و موجودی‌اش **صفر** می‌رود.
      setSkipped(all.length - parsed.length);
      setRows(parsed);
      setKey(crypto.randomUUID()); // کلید ثابت برای این فایل → re-submit امن (dedupe)
    } catch {
      setErr("خواندن فایل ناموفق بود. یک .xlsx معتبر انتخاب کن.");
    }
  }

  async function submit() {
    if (!ctx || rows.length === 0) return;
    if (scopeType === "warehouse" && !scopeWh) { setErr("انبار را برای scope انتخاب کن."); return; }
    setErr(""); setPending(true);
    try {
      const res = await fetch("/api/imports", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: ctx.tenantId, idempotencyKey: key, filename: fileName,
          scope: scopeType === "tenant" ? { type: "tenant" } : { type: "warehouse", warehouseId: scopeWh },
          rows,
        }),
      });
      if (res.ok) setResult(await res.json());
      else setErr(`خطا (${res.status})`);
    } finally { setPending(false); }
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
  if (ctx.role === "staff" && !hasPageAccess(ctx.allowedPages, "import"))
    return <main><div className="banner banner--error" role="alert"><Icon name="alert" /><span>دسترسیِ این بخش برایت باز نیست — از مدیر بخواه اضافه‌اش کند.</span></div></main>;

  const scopeName = warehouses.find((w) => w.id === scopeWh)?.name;
  // وقتی فهرستِ انبارها نیامده، «کل کارخانه» هم قفل می‌شود: نباید شکستِ بارگذاری
  // کاربر را به‌سمتِ گزینه‌ی مخرب هُل بدهد.
  const ready = rows.length > 0 && !whErr && (scopeType === "tenant" || !!scopeWh);

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>ورود موجودی از اکسل</h1>
          <p className="muted" style={{ margin: 0 }}>{ctx.tenantName}</p>
        </div>
        <nav><Link href="/staff">← پنل</Link><NavMenu /></nav>
      </div>

      {/* این عملیات مخرب است (موجودیِ غایب صفر می‌شود) — قبل از هر فیلدی گفته می‌شود */}
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          این یک <strong>Snapshot</strong> است: هر کالایی که در فایل <strong>نباشد</strong>،
          موجودی‌اش داخلِ دامنه‌ی انتخابی <strong>صفر می‌شود</strong>.
          فایل در مرورگر خوانده می‌شود و فقط ردیف‌ها به سرور می‌روند، نه خودِ فایل.
        </span>
      </div>

      <h2>۱. فایل</h2>
      <div className="card">
        <label htmlFor="xl">فایل اکسل — ستون‌ها: sku، انبار، موجودی (بچ/شید/کالیبر اختیاری)</label>
        <input id="xl" type="file" accept=".xlsx,.xls" onChange={onFile} />
        {fileName && <div className="subtle" style={{ marginTop: "var(--sp-2)" }}>{fileName}</div>}
        {rows.length > 0 && (
          <div className="row row--start" style={{ marginTop: "var(--sp-2)" }}>
            <span className="badge badge--ok"><Icon name="check" size={13} />{n(rows.length)} ردیفِ معتبر</span>
            {skipped > 0 && <span className="badge badge--warn">{n(skipped)} ردیف نادیده گرفته شد</span>}
          </div>
        )}
        {/* ردیفِ ناخوانده = کالایی که «غایب» حساب می‌شود و صفر می‌رود. سکوت اینجا گران است. */}
        {skipped > 0 && (
          <div className="banner banner--warn" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
            <Icon name="alert" />
            <span>
              {n(skipped)} ردیف چون ستونِ <strong>sku</strong> یا <strong>انبار</strong> نداشت خوانده نشد.
              اگر این کالاها باید در فایل می‌بودند، موجودی‌شان <strong>صفر خواهد شد</strong> — قبل از اعمال فایل را بررسی کنید.
            </span>
          </div>
        )}
      </div>

      <h2>۲. دامنه</h2>
      {whErr && (
        <div className="banner banner--error" role="alert">
          <Icon name="alert" />
          <span>
            {whErr} فهرستِ انبارها نیامد، پس اعمالِ Snapshot قفل است — تا اشتباهاً
            دامنه‌ی «کل کارخانه» انتخاب نشود. صفحه را دوباره باز کنید.
          </span>
        </div>
      )}
      <div className="card">
        <label htmlFor="scope">ردیف‌های غایب فقط داخل همین دامنه صفر می‌شوند</label>
        <div className="row row--start">
          <select id="scope" value={scopeType} style={{ maxWidth: 180 }}
            onChange={(e) => setScopeType(e.target.value as "tenant" | "warehouse")}>
            <option value="warehouse">یک انبار</option>
            <option value="tenant">کل کارخانه</option>
          </select>
          {scopeType === "warehouse" && (
            <select value={scopeWh} onChange={(e) => setScopeWh(e.target.value)} aria-label="انتخاب انبار"
              style={{ maxWidth: 260 }}>
              <option value="">انبار…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </select>
          )}
        </div>

        {/* «کل کارخانه» یعنی فایلِ یک انبار می‌تواند انبارِ دیگر را پاک کند (spec ۱۴.۵) */}
        {scopeType === "tenant" && (
          <div className="banner banner--error" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
            <Icon name="alert" />
            <span>
              دامنه <strong>کلِ کارخانه</strong> است: موجودیِ هر کالایی که در این فایل نباشد،
              <strong> در همه‌ی انبارها</strong> صفر می‌شود. اگر این فایل فقط مالِ یک انبار است،
              دامنه را روی همان انبار بگذارید.
            </span>
          </div>
        )}
      </div>

      <h2>۳. اعمال</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {ready
            ? <>‎{n(rows.length)} ردیف روی <strong>{scopeType === "tenant" ? "کل کارخانه" : scopeName}</strong> اعمال می‌شود.</>
            : rows.length === 0 ? "اول فایل را انتخاب کنید." : "دامنه را انتخاب کنید."}
        </p>
        <button onClick={submit} disabled={pending || !ready} aria-busy={pending}
          className={scopeType === "tenant" ? "danger" : "primary"}>
          {pending && <span className="spinner" aria-hidden="true" />}
          {pending ? "در حال اعمال…" : "اعمال Snapshot"}
        </button>
        {err && (
          <div className="banner banner--error" role="alert" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
            <Icon name="alert" /><span>{err}</span>
          </div>
        )}
      </div>

      {result && (
        <>
          <h2>نتیجه</h2>
          <div className={`banner banner--${result.errors.length > 0 ? "warn" : "ok"}`} role="status">
            <Icon name={result.errors.length > 0 ? "alert" : "check"} />
            <span>{result.deduped ? "این فایل قبلاً اعمال شده بود — چیزی دوباره اعمال نشد." : "اعمال شد."}</span>
          </div>
          <div className="card">
            <div className="row row--start" style={{ gap: "var(--sp-4)" }}>
              <span><span className="metric">{n(result.applied)}</span> <span className="muted">به‌روزرسانی/ساخت</span></span>
              {/* صفرشده عددِ مخرب است: اگر بزرگ‌تر از صفر باشد باید به چشم بیاید */}
              <span>
                <span className="metric" style={result.zeroed > 0 ? { color: "var(--warn)" } : undefined}>{n(result.zeroed)}</span>{" "}
                <span className="muted">صفرشده (غایب در فایل)</span>
              </span>
              <span><span className="metric">{n(result.errors.length)}</span> <span className="muted">خطا</span></span>
            </div>
            {result.errors.length > 0 && (
              <ul className="muted" style={{ marginBottom: 0 }}>
                {result.errors.slice(0, 20).map((e, i) => (
                  <li key={i}>ردیف {e.row ?? "-"}: {e.reason}{e.detail ? ` (${e.detail})` : ""}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </main>
  );
}
