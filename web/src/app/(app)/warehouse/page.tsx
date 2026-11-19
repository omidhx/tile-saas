"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { FileSpreadsheetIcon, PackagePlusIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState, LoadingState, Notice } from "@/components/states";
import { getJson, loadError } from "@/lib/api";
import { formatJalaliDate, formatJalaliDateTime } from "@/lib/date";
import { exportExcel } from "@/lib/excel";
import { useContexts, type Ctx } from "@/lib/useContexts";
import { PalletDialog, REASON_FA, type PalletMode } from "./pallet-dialog";
import {
  SearchBox, WarehouseFilter, lineName, location, lotLabel, num, palletSqcm, sqm, useDebounced, useWarehouses, type Pallet,
} from "./shared";

/**
 * لیست کالاهای انبار (فاز ۷): هر پالت با محل، ردیف‌ها (پالت ترکیبی چند ردیف دارد)، متراژ و وضعیت؛
 * ویرایش، انتقال و خروج غیرفروش از همان ردیف. تب «خروج‌ها» سابقه‌ی خروج غیرفروش است.
 */
export default function WarehousePage() {
  const { ctx, state } = useContexts("staff");
  if (state === "none") return <div className="p-4"><Notice tone="error">این بخش فقط برای پشتیبان است.</Notice></div>;
  if (!ctx) return <div className="p-4"><LoadingState /></div>;
  return <PalletList ctx={ctx} />;
}

type Exit = {
  id: string; occurredAt: string; palletNo: number | null; productName: string; productCode: string; grade: string | null;
  batchNumber: string | null; qty: number; reason: string | null; note: string | null; actorName: string | null; warehouseName: string;
};

function PalletList({ ctx }: { ctx: Ctx }) {
  const tenantId = ctx.tenantId;
  const warehouses = useWarehouses(tenantId);
  const [tab, setTab] = useState("in_stock");
  const [wh, setWh] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const [pallets, setPallets] = useState<Pallet[] | null>(null);
  const [exits, setExits] = useState<Exit[] | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<{ pallet: Pallet; mode: PalletMode } | null>(null);
  const gen = useRef(0);

  const load = useCallback(async () => {
    const my = ++gen.current;
    if (tab === "exits") {
      const r = await getJson<{ exits: Exit[] }>(`/api/pallets?tenantId=${tenantId}&view=exits`);
      if (my !== gen.current) return;
      setErr(r.ok ? "" : loadError(r.status));
      setExits(r.ok ? r.data.exits : null);
      return;
    }
    const r = await getJson<{ pallets: Pallet[] }>(
      `/api/pallets?tenantId=${tenantId}&status=${tab}${wh ? `&warehouseId=${wh}` : ""}${dq.trim() ? `&q=${encodeURIComponent(dq.trim())}` : ""}`);
    if (my !== gen.current) return;
    setErr(r.ok ? "" : loadError(r.status));
    setPallets(r.ok ? r.data.pallets : null);
  }, [tenantId, tab, wh, dq]);

  useEffect(() => { void load(); }, [load]);

  const cols: Column<Pallet>[] = [
    { key: "no", header: "پالت", sortValue: (p) => p.palletNo, cell: (p) => <span className="font-semibold tabular-nums">{num(p.palletNo)}</span> },
    { key: "wh", header: "انبار", sortValue: (p) => p.warehouseName, cell: (p) => p.warehouseName },
    {
      key: "loc", header: "محل", sortValue: (p) => (p.columnCode ?? "") + String(p.positionNo ?? 0).padStart(6, "0"),
      cell: (p) => location(p) ?? <Badge variant="warning">بدون محل</Badge>,
    },
    {
      key: "lines", header: "کالا", className: "md:min-w-56", cell: (p) => (
        <ul className="grid gap-0.5">
          {p.lines.map((l) => (
            <li key={l.lotId} className="leading-tight">
              <span className="font-medium">{lineName(l)}</span> <span className="tabular-nums">×{num(l.qty)}</span>
              {lotLabel(l) && <span className="block text-xs text-muted-foreground">{lotLabel(l)}</span>}
            </li>
          ))}
          {p.lines.length > 1 && <li><Badge variant="secondary">ترکیبی</Badge></li>}
        </ul>
      ),
    },
    { key: "boxes", header: "کارتن", sortValue: (p) => p.totalBoxes, cell: (p) => <span className="tabular-nums">{num(p.totalBoxes)}</span> },
    { key: "m2", header: "متراژ (م²)", sortValue: (p) => palletSqcm(p), cell: (p) => <span className="tabular-nums">{palletSqcm(p) ? sqm(palletSqcm(p)) : "—"}</span> },
    {
      key: "status", header: "وضعیت", cell: (p) => p.status === "in_stock"
        ? <Badge variant="success">در انبار</Badge> : <Badge variant="secondary">خارج‌شده</Badge>,
    },
    { key: "date", header: "ثبت", sortValue: (p) => p.createdAt, cell: (p) => <span className="text-xs text-muted-foreground">{formatJalaliDate(p.createdAt)}</span> },
    {
      key: "actions", header: "عملیات", actions: true, cell: (p) => p.status === "in_stock" ? (
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setOpen({ pallet: p, mode: "edit" })} aria-label={`ویرایش پالت ${p.palletNo}`}>ویرایش</Button>
          <Button size="sm" variant="outline" onClick={() => setOpen({ pallet: p, mode: "transfer" })} aria-label={`انتقال پالت ${p.palletNo}`}>انتقال</Button>
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setOpen({ pallet: p, mode: "exit" })} aria-label={`خروج از پالت ${p.palletNo}`}>خروج</Button>
        </div>
      ) : null,
    },
  ];

  const exitCols: Column<Exit>[] = [
    { key: "at", header: "زمان", sortValue: (e) => e.occurredAt, cell: (e) => <span className="text-xs">{formatJalaliDateTime(e.occurredAt)}</span> },
    { key: "no", header: "پالت", cell: (e) => (e.palletNo ? num(e.palletNo) : "—") },
    { key: "p", header: "کالا", sortValue: (e) => e.productName, cell: (e) => <>{lineName(e)}{e.batchNumber && <span className="block text-xs text-muted-foreground">بچ {e.batchNumber}</span>}</> },
    { key: "q", header: "کارتن", sortValue: (e) => e.qty, cell: (e) => <span className="tabular-nums">{num(e.qty)}</span> },
    { key: "r", header: "دلیل", cell: (e) => <>{REASON_FA[e.reason ?? ""] ?? e.reason}{e.note && <span className="block text-xs text-muted-foreground">{e.note}</span>}</> },
    { key: "wh", header: "انبار", cell: (e) => e.warehouseName },
    { key: "u", header: "ثبت‌کننده", cell: (e) => e.actorName ?? "—" },
  ];

  function excel() {
    if (tab === "exits") {
      void exportExcel("خروج-کالا", ["زمان", "پالت", "کالا", "کد", "درجه", "بچ", "کارتن", "دلیل", "توضیح", "انبار", "ثبت‌کننده"],
        (exits ?? []).map((e) => [formatJalaliDateTime(e.occurredAt), e.palletNo, e.productName, e.productCode, e.grade, e.batchNumber, e.qty,
          REASON_FA[e.reason ?? ""] ?? e.reason, e.note, e.warehouseName, e.actorName]));
      return;
    }
    void exportExcel("لیست-کالاهای-انبار", ["پالت", "انبار", "ستون", "شماره", "کالا", "کد", "درجه", "بچ", "شید", "کالیبر", "کارتن", "متراژ (م²)", "وضعیت", "تاریخ ثبت"],
      (pallets ?? []).flatMap((p) => p.lines.length ? p.lines.map((l) => [p.palletNo, p.warehouseName, p.columnCode, p.positionNo, l.productName, l.productCode, l.grade,
        l.batchNumber, l.shadeCode, l.caliberCode, l.qty, l.sqcmPerBox ? (l.qty * l.sqcmPerBox) / 10000 : null, "در انبار", formatJalaliDate(p.createdAt)])
        : [[p.palletNo, p.warehouseName, p.columnCode, p.positionNo, null, null, null, null, null, null, 0, null, "خارج‌شده", formatJalaliDate(p.createdAt)]]));
  }

  const rows = tab === "exits" ? exits : pallets;
  const totals = pallets && { n: pallets.length, boxes: pallets.reduce((s, p) => s + p.totalBoxes, 0), m2: pallets.reduce((s, p) => s + palletSqcm(p), 0) };

  return (
    <AppShell ctx={ctx} title="لیست کالاهای انبار"
      subtitle={tab !== "exits" && totals ? `${num(totals.n)} پالت · ${num(totals.boxes)} کارتن${totals.m2 ? ` · ${sqm(totals.m2)} مترمربع` : ""}` : undefined}
      actions={<>
        <Button variant="outline" size="sm" onClick={excel} disabled={!rows?.length}><FileSpreadsheetIcon />Excel</Button>
        <Button size="sm" asChild><Link href="/warehouse/goods-in"><PackagePlusIcon />ورود کالا</Link></Button>
      </>}>
      <div className="grid grid-cols-1 gap-3">
        {err && <Notice tone="error">{err}</Notice>}
        {note && <Notice tone="success">{note}</Notice>}
        <Tabs value={tab} onValueChange={(t) => { setTab(t); setNote(""); }}>
          <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b pb-1">
            <TabsTrigger value="in_stock" className="flex-none">در انبار</TabsTrigger>
            <TabsTrigger value="exited" className="flex-none">خارج‌شده</TabsTrigger>
            <TabsTrigger value="all" className="flex-none">همه</TabsTrigger>
            <TabsTrigger value="exits" className="flex-none">خروج‌ها</TabsTrigger>
          </TabsList>
          {tab !== "exits" && (
            <div className="flex flex-col gap-2 pt-3 sm:flex-row">
              <SearchBox label="جستجوی پالت" placeholder="کالا، کد، بچ، ستون یا شماره‌ی پالت" value={q} onChange={setQ} />
              <WarehouseFilter warehouses={warehouses} value={wh} onChange={setWh} />
            </div>
          )}
          {["in_stock", "exited", "all"].map((t) => (
            <TabsContent key={t} value={t} className="pt-3">
              {!pallets && !err ? <LoadingState /> : pallets && pallets.length === 0 ? <EmptyState>پالتی پیدا نشد.</EmptyState>
                : pallets && <DataTable label="پالت‌ها" testId="pallets" columns={cols} rows={pallets} rowKey={(p) => p.id} />}
            </TabsContent>
          ))}
          <TabsContent value="exits" className="pt-3">
            {!exits && !err ? <LoadingState /> : exits && exits.length === 0 ? <EmptyState>خروجی ثبت نشده است.</EmptyState>
              : exits && <DataTable label="خروج‌های غیرفروش" testId="exits" columns={exitCols} rows={exits} rowKey={(e) => e.id} />}
          </TabsContent>
        </Tabs>
      </div>
      {open && (
        <PalletDialog tenantId={tenantId} pallet={open.pallet} mode={open.mode} onClose={() => setOpen(null)}
          onDone={(msg) => { setOpen(null); setNote(msg); void load(); }} />
      )}
    </AppShell>
  );
}
