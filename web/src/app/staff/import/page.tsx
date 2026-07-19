"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import * as XLSX from "xlsx";

type Ctx = { tenantId: string; tenantName: string };
type Wh = { id: string; name: string; code: string };
type Row = { sku: string; warehouseCode: string; batchNumber: string | null; shadeCode: string | null; caliberCode: string | null; onHand: number };
type Result = { applied: number; zeroed: number; deduped: boolean; errors: { row: number | null; reason: string; detail?: string }[] };

// انتخابِ ستون بر اساس نام هدر (fa/en، case-insensitive)
const pick = (o: Record<string, unknown>, names: string[]) => {
  for (const k of Object.keys(o)) if (names.includes(k.trim().toLowerCase())) return o[k];
  return undefined;
};
const s = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());

export default function ImportPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [warehouses, setWarehouses] = useState<Wh[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [fileName, setFileName] = useState("");
  const [scopeType, setScopeType] = useState<"tenant" | "warehouse">("warehouse");
  const [scopeWh, setScopeWh] = useState("");
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/me");
      if (res.status === 401) { router.push("/login"); return; }
      const { contexts } = await res.json();
      const staffCtx = contexts?.find((c: { role?: string }) => c.role === "staff" || c.role === "admin") ?? contexts?.[0];
      if (!staffCtx) return;
      setCtx(staffCtx);
      const w = await fetch(`/api/warehouses?tenantId=${staffCtx.tenantId}`);
      if (w.ok) setWarehouses((await w.json()).warehouses);
    })();
  }, [router]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(""); setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);
      const parsed: Row[] = json
        .map((o) => ({
          sku: String(pick(o, ["sku", "کد", "code"]) ?? "").trim(),
          warehouseCode: String(pick(o, ["warehouse", "انبار", "wh", "code_wh"]) ?? "").trim(),
          batchNumber: s(pick(o, ["batch", "بچ", "batch_number", "بچ‌نامبر"])),
          shadeCode: s(pick(o, ["shade", "شید"])),
          caliberCode: s(pick(o, ["caliber", "کالیبر"])),
          onHand: Math.trunc(Number(pick(o, ["on_hand", "onhand", "موجودی", "قابل‌سفارش", "count", "qty"]) ?? 0)),
        }))
        .filter((r) => r.sku && r.warehouseCode);
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

  if (!ctx) return <main><p className="muted">در حال بارگذاری…</p></main>;

  return (
    <main>
      <div className="row"><h1>ورود موجودی از اکسل (Snapshot)</h1><Link href="/staff" className="muted">← پنل</Link></div>
      <p className="muted">{ctx.tenantName} — فایل در مرورگر پارس می‌شه؛ فقط ردیف‌ها به سرور می‌رن (نه خودِ فایل).</p>

      <div className="card">
        <label>فایل اکسل (ستون‌ها: sku، انبار، بچ/شید/کالیبر اختیاری، موجودی)</label>
        <input type="file" accept=".xlsx,.xls" onChange={onFile} />
        {rows.length > 0 && <p className="muted">{rows.length} ردیفِ معتبر خوانده شد.</p>}

        <label>دامنه‌ی Snapshot (ردیف‌های غایب فقط داخل همین دامنه صفر می‌شن)</label>
        <div className="row" style={{ gap: ".5rem", justifyContent: "flex-start" }}>
          <select value={scopeType} onChange={(e) => setScopeType(e.target.value as "tenant" | "warehouse")}
            style={{ padding: ".5rem", borderRadius: 8, border: "1px solid var(--line)" }}>
            <option value="warehouse">یک انبار</option>
            <option value="tenant">کل کارخانه</option>
          </select>
          {scopeType === "warehouse" && (
            <select value={scopeWh} onChange={(e) => setScopeWh(e.target.value)}
              style={{ padding: ".5rem", borderRadius: 8, border: "1px solid var(--line)" }}>
              <option value="">انبار…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
            </select>
          )}
        </div>

        <div style={{ marginTop: "1rem" }}>
          <button onClick={submit} disabled={pending || rows.length === 0}>
            {pending && <span className="spinner" />}{pending ? "در حال اعمال…" : "اعمال Snapshot"}
          </button>
        </div>
        {err && <div className="err">{err}</div>}
      </div>

      {result && (
        <div className="card">
          <strong>{result.deduped ? "این فایل قبلاً اعمال شده بود (dedupe)." : "اعمال شد."}</strong>
          <div className="muted">به‌روزرسانی/ساخت: {result.applied} · صفرشده (غایب): {result.zeroed} · خطا: {result.errors.length}</div>
          {result.errors.length > 0 && (
            <ul className="muted">
              {result.errors.slice(0, 20).map((e, i) => <li key={i}>ردیف {e.row ?? "-"}: {e.reason}{e.detail ? ` (${e.detail})` : ""}</li>)}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
