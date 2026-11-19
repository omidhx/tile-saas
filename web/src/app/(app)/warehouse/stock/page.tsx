"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileSpreadsheetIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState, LoadingState, Notice } from "@/components/states";
import { getJson, loadError } from "@/lib/api";
import { exportExcel } from "@/lib/excel";
import { useContexts, type Ctx } from "@/lib/useContexts";
import { SearchBox, WarehouseFilter, num, sqm, useDebounced, useWarehouses } from "../shared";

/**
 * جمع موجودی (فاز ۷): هر کالا در هر انبار. «قابل فروش» = موجودی − رزرو − تخصیص − بلوکه (قانون ۱؛ رزرو از
 * رزروهای فعالِ منقضی‌نشده حساب می‌شود، ستون ذخیره‌شده نیست). «بدون محل» کارتن‌هایی است که هنوز ستون ندارند.
 */
export default function StockPage() {
  const { ctx, state } = useContexts("staff");
  if (state === "none") return <div className="p-4"><Notice tone="error">این بخش فقط برای پشتیبان است.</Notice></div>;
  if (!ctx) return <div className="p-4"><LoadingState /></div>;
  return <Stock ctx={ctx} />;
}

type Row = {
  variantId: string; productName: string; productCode: string; sku: string; grade: string | null;
  warehouseId: string; warehouseName: string; sqcmPerBox: number | null; boxesPerPallet: number | null;
  onHand: number; held: number; allocated: number; blocked: number; available: number; lots: number; pallets: number; unplacedBoxes: number;
};

const n = (v: number) => <span className="tabular-nums">{num(v)}</span>;

function Stock({ ctx }: { ctx: Ctx }) {
  const tenantId = ctx.tenantId;
  const warehouses = useWarehouses(tenantId);
  const [wh, setWh] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const gen = useRef(0);

  const load = useCallback(async () => {
    const my = ++gen.current;
    const r = await getJson<{ rows: Row[] }>(`/api/stock?tenantId=${tenantId}${wh ? `&warehouseId=${wh}` : ""}${dq.trim() ? `&q=${encodeURIComponent(dq.trim())}` : ""}`);
    if (my !== gen.current) return;
    setErr(r.ok ? "" : loadError(r.status));
    setRows(r.ok ? r.data.rows : null);
  }, [tenantId, wh, dq]);
  useEffect(() => { void load(); }, [load]);

  const cols: Column<Row>[] = [
    { key: "p", header: "کالا", sortValue: (r) => r.productName, className: "md:min-w-40",
      cell: (r) => <><span className="font-medium">{r.productName}</span>{r.grade && <span className="text-muted-foreground"> درجه {r.grade}</span>}
        <span className="block text-xs text-muted-foreground">{r.productCode}</span></> },
    { key: "wh", header: "انبار", sortValue: (r) => r.warehouseName, cell: (r) => r.warehouseName },
    { key: "on", header: "موجودی (کارتن)", sortValue: (r) => r.onHand, cell: (r) => <span className="font-semibold tabular-nums">{num(r.onHand)}</span> },
    { key: "m2", header: "متراژ (م²)", sortValue: (r) => (r.sqcmPerBox ?? 0) * r.onHand, cell: (r) => <span className="tabular-nums">{r.sqcmPerBox ? sqm(r.sqcmPerBox * r.onHand) : "—"}</span> },
    { key: "pl", header: "پالت", sortValue: (r) => r.pallets, cell: (r) => n(r.pallets) },
    { key: "un", header: "بدون محل", sortValue: (r) => r.unplacedBoxes, cell: (r) => r.unplacedBoxes ? <span className="tabular-nums text-warning">{num(r.unplacedBoxes)}</span> : n(0) },
    { key: "held", header: "رزرو", sortValue: (r) => r.held, cell: (r) => n(r.held) },
    { key: "al", header: "تخصیص", sortValue: (r) => r.allocated, cell: (r) => n(r.allocated) },
    { key: "bl", header: "بلوکه", sortValue: (r) => r.blocked, cell: (r) => n(r.blocked) },
    { key: "av", header: "قابل فروش", sortValue: (r) => r.available, cell: (r) => <span className="font-semibold tabular-nums text-success">{num(r.available)}</span> },
  ];

  const sum = (f: (r: Row) => number) => (rows ?? []).reduce((s, r) => s + f(r), 0);
  const kpis = rows && [
    ["کل موجودی", `${num(sum((r) => r.onHand))} کارتن`],
    ["متراژ", `${sqm(sum((r) => (r.sqcmPerBox ?? 0) * r.onHand))} م²`],
    ["پالت", num(sum((r) => r.pallets))],
    ["قابل فروش", `${num(sum((r) => r.available))} کارتن`],
  ];

  return (
    <AppShell ctx={ctx} title="جمع موجودی"
      actions={<Button variant="outline" size="sm" disabled={!rows?.length} onClick={() => void exportExcel("جمع-موجودی",
        ["کالا", "کد", "درجه", "انبار", "موجودی (کارتن)", "متراژ (م²)", "پالت", "بدون محل", "رزرو", "تخصیص", "بلوکه", "قابل فروش"],
        (rows ?? []).map((r) => [r.productName, r.productCode, r.grade, r.warehouseName, r.onHand, r.sqcmPerBox ? (r.sqcmPerBox * r.onHand) / 10000 : null,
          r.pallets, r.unplacedBoxes, r.held, r.allocated, r.blocked, r.available]))}><FileSpreadsheetIcon />Excel</Button>}>
      <div className="grid grid-cols-1 gap-3">
        {err && <Notice tone="error">{err}</Notice>}
        {kpis && (
          <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {kpis.map(([k, v]) => (
              <div key={k} className="rounded-xl border bg-card p-3 shadow-xs">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchBox label="جستجوی کالا" placeholder="نام، کد یا sku" value={q} onChange={setQ} />
          <WarehouseFilter warehouses={warehouses} value={wh} onChange={setWh} />
        </div>
        {!rows && !err ? <LoadingState /> : rows && rows.length === 0 ? <EmptyState>موجودی‌ای نیست.</EmptyState>
          : rows && <DataTable label="جمع موجودی" testId="stock" columns={cols} rows={rows} rowKey={(r) => r.variantId + r.warehouseId} />}
      </div>
    </AppShell>
  );
}
