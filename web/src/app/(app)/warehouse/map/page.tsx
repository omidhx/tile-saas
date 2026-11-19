"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MoveIcon, PencilRulerIcon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/field";
import { EmptyState, LoadingState, Notice } from "@/components/states";
import { getJson, loadError, postJson } from "@/lib/api";
import { normalize } from "@/lib/search";
import { useContexts, type Ctx } from "@/lib/useContexts";
import { cn } from "@/lib/utils";
import { PalletDialog, type PalletMode } from "../pallet-dialog";
import { SearchBox, lineName, lotLabel, num, palletError, useWarehouses, type Pallet } from "../shared";
import { LayoutEditor, slotKey, slotName, type Cell } from "./layout-editor";

type MapStatus = "free" | "partial" | "reserved";
type MapPallet = Pallet & { mapStatus: MapStatus };

const STATUS: Record<MapStatus, { label: string; cell: string; dot: string }> = {
  free: { label: "آزاد", cell: "border-success bg-success/15", dot: "bg-success" },
  partial: { label: "بخشی رزرو", cell: "border-warning bg-warning/20", dot: "bg-warning" },
  reserved: { label: "تمام رزرو", cell: "border-destructive bg-destructive/15", dot: "bg-destructive" },
};
/** پالتِ رو در یک جا: بیشترین تعهد رنگ خانه را تعیین می‌کند. */
const worst = (ps: MapPallet[]): MapStatus =>
  ps.some((p) => p.mapStatus === "reserved") ? "reserved" : ps.some((p) => p.mapStatus === "partial") ? "partial" : "free";
const TRAY_MAX = 60;

/**
 * نقشه‌ی انبار (فاز ۸): مدیر چیدمان را یک بار روی شبکه می‌کشد (جای پالت = ستون + شماره، راهرو)، هر پالت روی
 * جای خودش با رنگ وضعیت، جستجوی کالا روی نقشه، و کشیدن پالت به جای دیگر برای انتقال. جابه‌جایی همان
 * `PATCH /api/pallets action=transfer` است؛ بدون ماوس: پالت را انتخاب کنید، «جابه‌جایی» و بعد خانه‌ی مقصد.
 */
export default function WarehouseMapPage() {
  const { ctx, state } = useContexts("staff");
  if (state === "none") return <div className="p-4"><Notice tone="error">این بخش فقط برای پشتیبان است.</Notice></div>;
  if (!ctx) return <div className="p-4"><LoadingState /></div>;
  return <WarehouseMap ctx={ctx} />;
}

function WarehouseMap({ ctx }: { ctx: Ctx }) {
  const tenantId = ctx.tenantId;
  const warehouses = useWarehouses(tenantId);
  const [wh, setWh] = useState("");
  const [data, setData] = useState<{ cells: Cell[]; pallets: MapPallet[]; truncated: boolean } | null>(null);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<{ slot: Cell | null; palletIds: string[] } | null>(null);
  const [moving, setMoving] = useState<MapPallet | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ pallet: Pallet; mode: PalletMode } | null>(null);
  const gen = useRef(0);
  const warehouseId = wh || warehouses[0]?.id || "";
  const whName = warehouses.find((w) => w.id === warehouseId)?.name ?? "";

  const load = useCallback(async () => {
    if (!warehouseId) return;
    const my = ++gen.current;
    const r = await getJson<{ cells: Cell[]; pallets: MapPallet[]; truncated: boolean }>(`/api/warehouse-map?tenantId=${tenantId}&warehouseId=${warehouseId}`);
    if (my !== gen.current) return;
    setErr(r.ok ? "" : loadError(r.status));
    setData(r.ok ? r.data : null);
  }, [tenantId, warehouseId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSelected(null); setMoving(null); setQ(""); }, [warehouseId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMoving(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const slots = new Set(data.cells.filter((c) => c.kind === "slot").map((c) => slotKey(c.columnCode!, c.positionNo!)));
    const at = new Map<string, MapPallet[]>();
    const off: MapPallet[] = [];
    for (const p of data.pallets) {
      const k = p.columnCode && p.positionNo ? slotKey(p.columnCode, p.positionNo) : null;
      if (k && slots.has(k)) at.set(k, [...(at.get(k) ?? []), p]);
      else off.push(p);
    }
    const nq = normalize(q);
    const match = (p: MapPallet) => !nq || [String(p.palletNo), ...p.lines.flatMap((l) => [l.productName, l.productCode, l.sku, l.batchNumber ?? ""])]
      .some((s) => normalize(s).includes(nq));
    const matches = new Set(data.pallets.filter(match).map((p) => p.id));
    const cols = Math.max(0, ...data.cells.map((c) => c.x + 1)), rows = Math.max(0, ...data.cells.map((c) => c.y + 1));
    const grid = new Map(data.cells.map((c) => [`${c.x},${c.y}`, c]));
    return { at, off, matches, cols, rows, grid, nq, onMap: data.pallets.length - off.length };
  }, [data, q]);

  const byId = useMemo(() => new Map((data?.pallets ?? []).map((p) => [p.id, p])), [data]);

  async function move(palletId: string, to: Cell) {
    const p = byId.get(palletId);
    setMoving(null); setDragging(false);
    if (!p || (p.columnCode && p.positionNo && slotKey(p.columnCode, p.positionNo) === slotKey(to.columnCode!, to.positionNo!))) return;
    setBusy(true); setNote(""); setErr("");
    try {
      // همان انتقالِ کلِ پالت (بدون lines)؛ سرور زیرِ قفلِ موجودی جابه‌جا می‌کند
      const r = await postJson("/api/pallets", { tenantId, action: "transfer", palletId, columnCode: to.columnCode, positionNo: to.positionNo }, "PATCH");
      if (!r.ok) { setErr(palletError(r.error, r.status)); return; }
      setNote(`پالت ${num(p.palletNo)} به ${slotName(to)} منتقل شد.`);
      setSelected({ slot: to, palletIds: [palletId] });
      await load();
    } finally { setBusy(false); }
  }

  const picked = (selected?.palletIds ?? []).map((id) => byId.get(id)).filter((p): p is MapPallet => !!p);
  const slotPallets = (c: Cell) => view?.at.get(slotKey(c.columnCode!, c.positionNo!)) ?? [];
  const tray = view ? (view.nq ? view.off.filter((p) => view.matches.has(p.id)) : view.off) : [];

  if (editing && data) {
    return (
      <AppShell ctx={ctx} title="ویرایش چیدمان" subtitle={whName}>
        <LayoutEditor tenantId={tenantId} warehouseId={warehouseId} initial={data.cells}
          onCancel={() => setEditing(false)}
          onSaved={(msg) => { setEditing(false); setNote(msg); setSelected(null); void load(); }} />
      </AppShell>
    );
  }

  return (
    <AppShell ctx={ctx} title="نقشه‌ی انبار"
      subtitle={view && data ? `${num(data.pallets.length)} پالت · ${num(view.onMap)} روی نقشه · ${num(view.off.length)} بیرون از نقشه` : undefined}
      actions={ctx.role === "admin" && data ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}><PencilRulerIcon />ویرایش چیدمان</Button> : undefined}>
      <div className="grid grid-cols-1 gap-3">
        {err && <Notice tone="error">{err}</Notice>}
        {note && <Notice tone="success">{note}</Notice>}
        {data?.truncated && <Notice tone="warning">این انبار بیش از ۲۰۰۰ پالت دارد و فقط ۲۰۰۰ تای اول روی نقشه آمده است.</Notice>}
        <div className="flex flex-col gap-2 sm:flex-row">
          <SearchBox label="جستجوی کالا روی نقشه" placeholder="کالا، کد، بچ یا شماره‌ی پالت" value={q} onChange={setQ} />
          <NativeSelect aria-label="انبار" value={warehouseId} onChange={(e) => setWh(e.target.value)} className="h-9 sm:w-48">
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </NativeSelect>
        </div>
        {view?.nq && (
          <p role="status" className="text-sm text-muted-foreground">
            {num(view.matches.size)} پالت پیدا شد{view.matches.size ? `؛ ${num([...view.matches].filter((id) => !view.off.some((p) => p.id === id)).length)} روی نقشه` : ""}.
          </p>
        )}
        {moving && (
          <Notice tone="warning" action={<Button size="sm" variant="outline" onClick={() => setMoving(null)}>انصراف</Button>}>
            جای مقصد پالت {num(moving.palletNo)} را روی نقشه بزنید.
          </Notice>
        )}

        {!data && !err ? <LoadingState /> : data && view && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <section className="grid min-w-0 content-start gap-3 rounded-xl border bg-card p-3">
              <Legend />
              {data.cells.length === 0 ? (
                <EmptyState>{ctx.role === "admin" ? "هنوز چیدمانی برای این انبار کشیده نشده؛ «ویرایش چیدمان» را بزنید." : "هنوز چیدمانی برای این انبار کشیده نشده؛ از مدیر کارخانه بخواهید آن را بکشد."}</EmptyState>
              ) : (
                <div data-map-scroll className="overflow-auto pb-1">
                  <div role="group" aria-label={`نقشه‌ی ${whName}`} className="grid w-max gap-1"
                    style={{ gridTemplateColumns: `repeat(${view.cols}, 2.75rem)` }}>
                    {Array.from({ length: view.rows * view.cols }, (_, i) => {
                      const x = i % view.cols, y = Math.floor(i / view.cols), c = view.grid.get(`${x},${y}`);
                      if (!c) return <div key={i} aria-hidden="true" className="size-11" />;
                      if (c.kind === "aisle") return <div key={i} aria-hidden="true" title="راهرو" className="size-11 rounded-md bg-muted [background-image:repeating-linear-gradient(45deg,transparent_0_6px,var(--border)_6px_7px)]" />;
                      const ps = slotPallets(c), top = ps[ps.length - 1];
                      const hit = !!view.nq && ps.some((p) => view.matches.has(p.id));
                      const dim = !!view.nq && !hit;
                      const isSel = selected?.slot && slotKey(selected.slot.columnCode!, selected.slot.positionNo!) === slotKey(c.columnCode!, c.positionNo!);
                      const target = !!moving || dragging;
                      // نام دسترس‌پذیر از خود متن می‌آید (نه aria-label)، تا متن دیده‌شده بخشی از نام باشد
                      const detail = (ps.length
                        ? ps.map((p) => `پالت ${num(p.palletNo)}، ${num(p.totalBoxes)} کارتن، ${STATUS[p.mapStatus].label}`).join(" · ")
                        : "خالی") + (hit ? " (پیدا شد)" : "");
                      return (
                        <button key={i} type="button" aria-pressed={!!isSel} disabled={busy}
                          data-slot={`${c.columnCode}${c.positionNo}`}
                          draggable={!!top && !busy}
                          onDragStart={(e) => { e.dataTransfer.setData("text/plain", top.id); e.dataTransfer.effectAllowed = "move"; setDragging(true); }}
                          onDragEnd={() => setDragging(false)}
                          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                          onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) void move(id, c); }}
                          onClick={() => moving ? void move(moving.id, c) : setSelected({ slot: c, palletIds: ps.map((p) => p.id) })}
                          className={cn(
                            "relative flex size-11 flex-col items-center justify-center rounded-md border text-[10px] leading-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                            ps.length && !dim ? STATUS[worst(ps)].cell : "border-dashed border-border bg-background",
                            dim && ps.length && "border-solid bg-muted text-muted-foreground",
                            hit && "ring-2 ring-primary ring-offset-1 ring-offset-background",
                            isSel && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
                            target && "hover:bg-primary/15",
                            top && "cursor-grab",
                          )}>
                          <span className="sr-only">جای </span><span className="text-muted-foreground">{slotName(c)}</span>
                          {top && <> <span aria-hidden="true" className="text-xs font-semibold tabular-nums">{num(ps.reduce((s, p) => s + p.totalBoxes, 0))}</span></>}
                          {ps.length > 1 && <span aria-hidden="true" className="absolute -top-1.5 -end-1.5 rounded-full bg-foreground px-1 text-[9px] text-background">×{num(ps.length)}</span>}
                          <span className="sr-only">: {detail}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            <aside className="grid content-start gap-3">
              <section aria-label="جزئیات" className="grid gap-2 rounded-xl border bg-card p-3">
                {!selected ? <p className="text-sm text-muted-foreground">روی یک جا یا پالت بزنید تا جزئیاتش را ببینید. برای انتقال، پالت را روی جای دیگر بکشید.</p> : (
                  <>
                    <h2 className="text-sm font-semibold">{selected.slot ? `جای ${slotName(selected.slot)}` : "بیرون از نقشه"}</h2>
                    {picked.length === 0 && <p className="text-sm text-muted-foreground">این جا خالی است.</p>}
                    {picked.map((p) => (
                      <article key={p.id} className="grid gap-1.5 rounded-lg border p-2 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">پالت {num(p.palletNo)}</span>
                          <span className="flex items-center gap-1.5 text-xs"><span aria-hidden="true" className={cn("size-2.5 rounded-full", STATUS[p.mapStatus].dot)} />{STATUS[p.mapStatus].label}</span>
                        </div>
                        <ul className="grid gap-0.5">
                          {p.lines.map((l) => (
                            <li key={l.lotId}>{lineName(l)} <span className="tabular-nums">×{num(l.qty)}</span>
                              {lotLabel(l) && <span className="block text-xs text-muted-foreground">{lotLabel(l)}</span>}</li>
                          ))}
                        </ul>
                        {p.lines.length > 1 && <Badge variant="secondary">ترکیبی</Badge>}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {data && data.cells.length > 0 && <Button size="sm" onClick={() => setMoving(p)} aria-label={`جابه‌جایی پالت ${p.palletNo} روی نقشه`}><MoveIcon />جابه‌جایی</Button>}
                          <Button size="sm" variant="outline" onClick={() => setDialog({ pallet: p, mode: "transfer" })}>انتقال بخشی</Button>
                          <Button size="sm" variant="outline" onClick={() => setDialog({ pallet: p, mode: "edit" })}>ویرایش</Button>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setDialog({ pallet: p, mode: "exit" })}>خروج</Button>
                        </div>
                      </article>
                    ))}
                  </>
                )}
              </section>

              <section aria-labelledby="tray-h" className="grid gap-2 rounded-xl border bg-card p-3">
                <h2 id="tray-h" className="text-sm font-semibold">بیرون از نقشه <span className="font-normal text-muted-foreground">({num(tray.length)})</span></h2>
                <p className="text-xs text-muted-foreground">پالت بدون محل، یا با محلی که روی چیدمان نیست. روی نقشه بکشید تا جایش ثبت شود.</p>
                {tray.length === 0 ? <p className="text-sm text-muted-foreground">پالتی نیست.</p> : (
                  <ul className="grid max-h-80 gap-1 overflow-y-auto">
                    {tray.slice(0, TRAY_MAX).map((p) => (
                      <li key={p.id}>
                        <button type="button" draggable={!busy} disabled={busy}
                          onDragStart={(e) => { e.dataTransfer.setData("text/plain", p.id); e.dataTransfer.effectAllowed = "move"; setDragging(true); }}
                          onDragEnd={() => setDragging(false)}
                          onClick={() => setSelected({ slot: null, palletIds: [p.id] })}
                          className="flex w-full cursor-grab items-center gap-2 rounded-md border px-2 py-1.5 text-start text-sm hover:bg-muted pointer-coarse:min-h-11">
                          <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", STATUS[p.mapStatus].dot)} />
                          <span className="font-semibold tabular-nums"><span className="sr-only">پالت </span>{num(p.palletNo)}</span>
                          <span className="min-w-0 flex-1 truncate">{p.lines.map((l) => lineName(l)).join("، ")}</span>
                          <span className="tabular-nums text-muted-foreground">×{num(p.totalBoxes)}</span>
                          <span className="sr-only">کارتن، {STATUS[p.mapStatus].label}{p.columnCode ? `، محل ثبت‌شده ${p.columnCode}${p.positionNo ?? ""}` : ""}</span>
                        </button>
                      </li>
                    ))}
                    {tray.length > TRAY_MAX && <li className="text-xs text-muted-foreground">و {num(tray.length - TRAY_MAX)} پالت دیگر؛ با جستجو پیدایشان کنید.</li>}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        )}
      </div>
      {dialog && (
        <PalletDialog tenantId={tenantId} pallet={dialog.pallet} mode={dialog.mode} onClose={() => setDialog(null)}
          onDone={(msg) => { setDialog(null); setNote(msg); void load(); }} />
      )}
    </AppShell>
  );
}

function Legend() {
  return (
    <ul aria-label="راهنمای رنگ" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {(Object.keys(STATUS) as MapStatus[]).map((s) => (
        <li key={s} className="flex items-center gap-1.5"><span aria-hidden="true" className={cn("size-3 rounded-sm border", STATUS[s].cell)} />{STATUS[s].label}</li>
      ))}
      <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm border border-dashed" />جای خالی</li>
      <li className="flex items-center gap-1.5"><span aria-hidden="true" className="size-3 rounded-sm bg-muted [background-image:repeating-linear-gradient(45deg,transparent_0_2px,var(--border)_2px_3px)]" />راهرو</li>
    </ul>
  );
}
