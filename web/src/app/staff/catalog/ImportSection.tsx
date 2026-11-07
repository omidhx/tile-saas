"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../../Icon";
import { getJson, loadError, postJson, actionError } from "@/lib/api";
import { sheetRows } from "@/lib/importRows";
import type { Ctx } from "@/lib/useContexts";
import type { ImportResult, ImportError } from "@/db/imports";

const n = (v: number) => v.toLocaleString("fa-IR");
const MAX_FILE_BYTES = 10 * 1024 * 1024; // فایلِ موجودی هیچ‌وقت واقعاً این‌قدر بزرگ نیست

type Wh = { id: string; name: string; code: string };
type Batch = { id: string; filename: string; status: string; committedAt: string | null; rows: number };

const REASON: Record<string, string> = {
  missing_quantity: "موجودی خالی است",
  bad_quantity: "موجودی عددِ صحیحِ نامنفی نیست",
  missing_sku: "کدِ کالا خالی است",
  missing_warehouse: "انبار خالی است",
  unknown_sku: "کالایی با این کد نیست (برای ساختِ کالای تازه ستونِ نام لازم است)",
  unknown_warehouse: "انباری با این کد نیست",
  out_of_scope: "بیرون از دامنه‌ی انتخاب‌شده",
  duplicate_row: "این lot دو بار در فایل آمده",
  ambiguous_lot: "دو lot با همین مشخصات هست",
  below_committed: "کمتر از مقدارِ رزرو و تخصیص‌شده",
  absent_but_committed: "در فایل نیست ولی رزرو یا تخصیص دارد",
  missing_shade_caliber: "شید و کالیبر برای این کارخانه اجباری است",
  empty_file: "فایل هیچ ردیفی ندارد",
};
const UNDO_ERROR: Record<string, string> = {
  not_latest: "فقط آخرین ایمپورت برمی‌گردد.",
  not_committed: "این ایمپورت قبلاً برگردانده شده.",
  below_committed: "برگشت موجودی را زیرِ رزرو و تخصیصِ فعلی می‌برد؛ انجام نشد.",
};

function Errors({ errors }: { errors: ImportError[] }) {
  return (
    <ul style={{ marginBottom: 0 }}>
      {errors.slice(0, 50).map((e, i) => (
        <li key={i}>{e.row ? `ردیف ${n(e.row)}: ` : ""}{REASON[e.reason] ?? e.reason}{e.detail ? ` (${e.detail})` : ""}</li>
      ))}
      {errors.length > 50 && <li>و {n(errors.length - 50)} خطای دیگر</li>}
    </ul>
  );
}

export default function ImportSection({ ctx }: { ctx: Ctx }) {
  const [warehouses, setWarehouses] = useState<Wh[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState("");
  const [scopeType, setScopeType] = useState<"tenant" | "warehouse">("warehouse");
  const [scopeWh, setScopeWh] = useState("");
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [err, setErr] = useState("");
  const [whErr, setWhErr] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);

  const loadBatches = useCallback(async () => {
    const b = await getJson<{ imports: Batch[] }>(`/api/imports?tenantId=${ctx.tenantId}`);
    if (b.ok) setBatches(b.data.imports);
  }, [ctx.tenantId]);

  useEffect(() => {
    (async () => {
      const w = await getJson<{ warehouses: Wh[] }>(`/api/warehouses?tenantId=${ctx.tenantId}`);
      // بدونِ فهرستِ انبار کاربر به «کل کارخانه» هُل داده می‌شود؛ پس قفل می‌کنیم
      if (w.ok) setWarehouses(w.data.warehouses);
      else setWhErr(loadError(w.status));
      await loadBatches();
    })();
  }, [ctx.tenantId, loadBatches]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(""); setResult(null); setPreview(null); setRows([]);
    const file = e.target.files?.[0];
    if (!file) return;
    // پارسِ xlsx در تبِ همین کارمند اجرا می‌شود؛ سقفِ حجم فایلِ غول‌پیکر را قبل از parse رد می‌کند
    if (file.size > MAX_FILE_BYTES) { setErr(`فایل خیلی بزرگ است (حداکثر ${MAX_FILE_BYTES / 1024 / 1024} مگابایت).`); return; }
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx"); // ~۷۰۰KB، فقط وقتی فایلی انتخاب شد
      // هیچ تفسیری این‌جا نیست: خالی صفر نمی‌شود و ردیفی دور ریخته نمی‌شود. سرور می‌سنجد.
      setRows(sheetRows(XLSX, await file.arrayBuffer()));
      setKey(crypto.randomUUID()); // یک کلید برای این فایل → فرستادنِ دوباره امن است
    } catch {
      setErr("خواندن فایل ناموفق بود. یک .xlsx معتبر انتخاب کن.");
    }
  }

  const scope = scopeType === "tenant" ? { type: "tenant" as const } : { type: "warehouse" as const, warehouseId: scopeWh };
  const send = (isPreview: boolean) => postJson("/api/imports", {
    tenantId: ctx.tenantId, idempotencyKey: key, filename: fileName, scope, rows, preview: isPreview,
  });

  async function runPreview() {
    setErr(""); setResult(null); setPending(true);
    try {
      const res = await send(true);
      if (res.ok) setPreview(res.data as ImportResult);
      else setErr(res.error === "scope_not_found" ? "انبارِ انتخاب‌شده پیدا نشد." : actionError(res.status));
    } finally { setPending(false); }
  }

  async function apply() {
    setErr(""); setPending(true);
    try {
      const res = await send(false);
      if (res.ok) { setResult(res.data as ImportResult); setPreview(null); setRows([]); await loadBatches(); }
      else if (res.status === 422) {
        // بین پیش‌نمایش و اعمال موجودی عوض شد (مثلاً رزروِ تازه). چیزی نوشته نشد.
        setPreview(res.data as ImportResult);
        setErr("موجودی بعد از پیش‌نمایش عوض شد و فایل دیگر قابلِ اعمال نیست. هیچ تغییری ثبت نشد.");
      } else setErr(actionError(res.status));
    } finally { setPending(false); }
  }

  async function undo(b: Batch) {
    if (!confirm(`ایمپورتِ «${b.filename}» برگردانده شود؟ موجودیِ هر lot به اندازه‌ی تغییرِ همین ایمپورت برمی‌گردد.`)) return;
    setErr(""); setPending(true);
    try {
      const res = await postJson("/api/imports", { tenantId: ctx.tenantId, batchId: b.id }, "DELETE");
      if (!res.ok) setErr(UNDO_ERROR[res.error ?? ""] ?? actionError(res.status));
      else setResult(null);
      await loadBatches();
    } finally { setPending(false); }
  }

  const scopeName = warehouses.find((w) => w.id === scopeWh)?.name;
  const scopeReady = rows.length > 0 && !whErr && (scopeType === "tenant" || !!scopeWh);
  const canApply = scopeReady && preview?.ok === true && !preview.deduped;
  const latest = batches.find((b) => b.status === "committed");

  return (
    <>
      <div className="banner banner--info">
        <Icon name="info" />
        <span>
          این یک <strong>Snapshot</strong> است: هر کالایی که در فایل <strong>نباشد</strong>،
          موجودی‌اش داخلِ دامنه‌ی انتخابی <strong>صفر می‌شود</strong>. اول پیش‌نمایش را ببینید؛
          فایلی که حتی یک ردیفِ خراب دارد اعمال نمی‌شود. ایمپورتِ آخر را می‌شود برگرداند.
        </span>
      </div>

      <h2>۱. فایل</h2>
      <div className="card">
        <label htmlFor="xl">فایل اکسل — ستون‌ها: کد (sku)، انبار، موجودی (بچ/شید/کالیبر و نام اختیاری)</label>
        <input id="xl" type="file" accept=".xlsx,.xls" onChange={onFile} />
        {fileName && <div className="subtle" style={{ marginTop: "var(--sp-2)" }}>{fileName}</div>}
        {rows.length > 0 && (
          <div className="row row--start" style={{ marginTop: "var(--sp-2)" }}>
            <span className="badge badge--ok"><Icon name="check" size={13} />{n(rows.length)} ردیف خوانده شد</span>
          </div>
        )}
      </div>

      <h2>۲. دامنه</h2>
      {whErr && (
        <div className="banner banner--error" role="alert">
          <Icon name="alert" />
          <span>{whErr} فهرستِ انبارها نیامد، پس ایمپورت قفل است. صفحه را دوباره باز کنید.</span>
        </div>
      )}
      <div className="card">
        <label htmlFor="scope">ردیف‌های غایب فقط داخل همین دامنه صفر می‌شوند</label>
        <div className="row row--start">
          <select id="scope" value={scopeType} style={{ maxWidth: 180 }}
            onChange={(e) => { setScopeType(e.target.value as "tenant" | "warehouse"); setPreview(null); }}>
            <option value="warehouse">یک انبار</option>
            <option value="tenant">کل کارخانه</option>
          </select>
          {scopeType === "warehouse" && (
            <select value={scopeWh} onChange={(e) => { setScopeWh(e.target.value); setPreview(null); }} aria-label="انتخاب انبار"
              style={{ maxWidth: 260 }}>
              <option value="">انبار…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </select>
          )}
        </div>
        {scopeType === "tenant" && (
          <div className="banner banner--error" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
            <Icon name="alert" />
            <span>
              دامنه <strong>کلِ کارخانه</strong> است: موجودیِ هر کالایی که در این فایل نباشد،
              <strong> در همه‌ی انبارها</strong> صفر می‌شود.
            </span>
          </div>
        )}
      </div>

      <h2>۳. پیش‌نمایش و اعمال</h2>
      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          {scopeReady
            ? <>‎{n(rows.length)} ردیف روی <strong>{scopeType === "tenant" ? "کل کارخانه" : scopeName}</strong>.</>
            : rows.length === 0 ? "اول فایل را انتخاب کنید." : "دامنه را انتخاب کنید."}
        </p>
        <div className="row row--start">
          <button onClick={runPreview} disabled={pending || !scopeReady} aria-busy={pending} className="secondary">
            {pending && !preview && <span className="spinner" aria-hidden="true" />}
            پیش‌نمایش
          </button>
          <button onClick={apply} disabled={pending || !canApply} aria-busy={pending}
            className={scopeType === "tenant" ? "danger" : "primary"}>
            {pending && preview && <span className="spinner" aria-hidden="true" />}
            اعمال
          </button>
        </div>
        {err && (
          <div className="banner banner--error" role="alert" style={{ marginTop: "var(--sp-3)", marginBottom: 0 }}>
            <Icon name="alert" /><span>{err}</span>
          </div>
        )}
      </div>

      {preview && (
        <div className="card" aria-label="پیش‌نمایش">
          {preview.deduped ? <p>این فایل قبلاً اعمال شده بود.</p> : preview.ok ? (
            <div className="banner banner--ok" role="status"><Icon name="check" /><span>فایل سالم است. هنوز چیزی ثبت نشده.</span></div>
          ) : (
            <div className="banner banner--error" role="alert">
              <Icon name="alert" />
              <span>{n(preview.errors.length)} خطا. تا فایل اصلاح نشود هیچ ردیفی اعمال نمی‌شود.</span>
            </div>
          )}
          {!preview.ok && <Errors errors={preview.errors} />}
          {preview.ok && !preview.deduped && (
            <>
              <div className="row row--start" style={{ gap: "var(--sp-4)" }}>
                <span><span className="metric">{n(preview.changes.length - preview.zeroed)}</span> <span className="muted">تغییر</span></span>
                <span><span className="metric">{n(preview.newLots)}</span> <span className="muted">lot تازه</span></span>
                <span><span className="metric">{n(preview.newProducts)}</span> <span className="muted">کالای تازه</span></span>
                <span>
                  <span className="metric" style={preview.zeroed > 0 ? { color: "var(--warn)" } : undefined}>{n(preview.zeroed)}</span>{" "}
                  <span className="muted">صفر می‌شود (غایب در فایل)</span>
                </span>
              </div>
              {preview.changes.length > 0 && (
                <table>
                  <thead><tr><th>ردیف</th><th>کد</th><th>انبار</th><th>بچ</th><th>قبل</th><th>بعد</th></tr></thead>
                  <tbody>
                    {preview.changes.slice(0, 100).map((c, i) => (
                      <tr key={i}>
                        <td>{c.row ? n(c.row) : "غایب"}</td><td>{c.sku}</td><td>{c.warehouseCode}</td>
                        <td>{c.batchNumber ?? "-"}{c.shadeCode ? ` / ${c.shadeCode}` : ""}{c.caliberCode ? ` / ${c.caliberCode}` : ""}</td>
                        <td>{c.lotId ? n(c.before) : "تازه"}</td><td>{n(c.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {preview.changes.length > 100 && <p className="muted">و {n(preview.changes.length - 100)} تغییرِ دیگر</p>}
            </>
          )}
        </div>
      )}

      {result && (
        <div className="banner banner--ok" role="status">
          <Icon name="check" />
          <span>{result.deduped ? "این فایل قبلاً اعمال شده بود — چیزی دوباره اعمال نشد." : `اعمال شد: ${n(result.applied)} ردیف، ${n(result.zeroed)} صفرشده.`}</span>
        </div>
      )}

      {batches.length > 0 && (
        <>
          <h2>ایمپورت‌های اخیر</h2>
          <div className="card">
            <ul style={{ margin: 0 }}>
              {batches.map((b) => (
                <li key={b.id}>
                  {b.filename} · {n(b.rows)} ردیف · {b.status === "reverted" ? "برگردانده شد" : "اعمال‌شده"}
                  {b.committedAt && <span className="muted"> · {new Date(b.committedAt).toLocaleString("fa-IR")}</span>}
                  {b === latest && (
                    <button className="secondary" style={{ marginInlineStart: "var(--sp-2)" }} disabled={pending} onClick={() => undo(b)}>
                      برگرداندن
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
