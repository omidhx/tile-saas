"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/field";
import { Notice } from "@/components/states";
import { postJson } from "@/lib/api";
import { normalize } from "@/lib/search";
import { columnKey, slotKey } from "@/lib/slotKey";
import { cn } from "@/lib/utils";
import { num } from "../shared";

/** خانه‌ی چیدمان، همان شکل `/api/warehouse-map` (فاز ۸). */
export type Cell = { x: number; y: number; kind: "slot" | "aisle"; columnCode: string | null; positionNo: number | null };
/** «A۳»؛ ستونِ عددی با خط تیره («۱۲-۳») تا ستون ۱ شماره‌ی ۲۳ با ستون ۱۲ شماره‌ی ۳ یکی خوانده نشود. */
export const slotName = (c: Pick<Cell, "columnCode" | "positionNo">) =>
  `${c.columnCode}${/[0-9۰-۹٠-٩]$/.test(c.columnCode ?? "") ? "-" : ""}${num(c.positionNo ?? 0)}`;

type Tool = "slot" | "aisle" | "erase";
const MAX = 60;
const TOOLS: [Tool, string][] = [["slot", "جای پالت"], ["aisle", "راهرو"], ["erase", "پاک کن"]];
const ERR: Record<string, string> = {
  duplicate_slot: "یک «ستون + شماره» دو جا روی نقشه آمده است.",
  duplicate_cell: "یک خانه دو بار آمده است.",
  invalid_cell: "خانه‌ای بیرون از شبکه یا جای پالت بدون ستون و شماره.",
  warehouse_not_found: "انبار پیدا نشد.",
};

/**
 * ویرایشگر چیدمان: شبکه‌ای از خانه‌ها؛ با ابزار «جای پالت» هر کلیک (یا کشیدن ماوس روی چند خانه) یک جا با
 * ستون و شماره‌ی بعدی می‌سازد (A1، A2، A3…)، «راهرو» راهرو و «پاک کن» خانه را خالی می‌کند. ذخیره کل چیدمان
 * را جایگزین می‌کند و هیچ پالتی را عوض نمی‌کند؛ پالتی که جایش حذف شود «بیرون از نقشه» دیده می‌شود.
 */
export function LayoutEditor({
  tenantId, warehouseId, initial, onCancel, onSaved,
}: { tenantId: string; warehouseId: string; initial: Cell[]; onCancel: () => void; onSaved: (msg: string) => void }) {
  const [cells, setCells] = useState(() => new Map(initial.map((c) => [`${c.x},${c.y}`, c])));
  const [cols, setCols] = useState(() => Math.max(16, ...initial.map((c) => c.x + 1)));
  const [rows, setRows] = useState(() => Math.max(10, ...initial.map((c) => c.y + 1)));
  const [tool, setTool] = useState<Tool>("slot");
  const [code, setCode] = useState("A");
  const [next, setNext] = useState(() => String(maxPos(initial, "A") + 1));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  // کشیدن ماوس روی چند خانه در یک رویداد پشت هم: state هنوز تازه نشده، پس آخرین مقدار در ref
  const live = useRef({ cells, next });
  live.current = { cells, next };
  const painting = useRef(false);
  useEffect(() => {
    const up = () => { painting.current = false; };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  const minCols = Math.max(1, ...[...cells.values()].map((c) => c.x + 1));
  const minRows = Math.max(1, ...[...cells.values()].map((c) => c.y + 1));

  function apply(x: number, y: number, dragged = false) {
    const k = `${x},${y}`;
    const m = new Map(live.current.cells);
    if (tool === "erase") m.delete(k);
    else if (tool === "aisle") m.set(k, { x, y, kind: "aisle", columnCode: null, positionNo: null });
    else {
      const col = columnKey(code), pos = Number(normalize(live.current.next));
      if (!col) { setError("اول نام ستون را بنویسید."); return; }
      if (!Number.isInteger(pos) || pos < 1) { setError("شماره‌ی بعدی باید عدد صحیح مثبت باشد."); return; }
      const cur = m.get(k);
      // جای موجود هرگز بی‌صدا شماره‌ی تازه نمی‌گیرد (کشیدن دوباره روی همان خانه‌ها شماره را جا می‌انداخت)
      if (cur?.kind === "slot") { if (!dragged) setError(`این خانه جای ${slotName(cur)} است؛ برای عوض کردنش اول «پاک کن».`); return; }
      const clash = [...m.values()].find((c) => c.kind === "slot" && slotKey(c.columnCode!, c.positionNo!) === slotKey(col, pos));
      if (clash) { setError(`${slotName(clash)} قبلاً روی نقشه هست؛ شماره‌ی بعدی را عوض کنید.`); return; }
      m.set(k, { x, y, kind: "slot", columnCode: col, positionNo: pos });
      live.current.next = String(pos + 1);
      setNext(String(pos + 1));
    }
    setError("");
    live.current.cells = m;
    setCells(m);
  }

  async function save() {
    setPending(true); setError("");
    try {
      const r = await postJson("/api/warehouse-map", { tenantId, warehouseId, cells: [...cells.values()] }, "PUT");
      if (!r.ok) { setError(ERR[r.error ?? ""] ?? (r.status === 403 ? "فقط مدیر کارخانه چیدمان را عوض می‌کند." : `ذخیره نشد (خطای ${r.status}).`)); return; }
      const d = r.data as { offMap: number };
      const slots = [...cells.values()].filter((c) => c.kind === "slot").length;
      onSaved(`چیدمان ذخیره شد: ${num(slots)} جای پالت و ${num(cells.size - slots)} راهرو.`
        + (d.offMap ? ` ${num(d.offMap)} پالت محلی دارند که روی این چیدمان نیست و در «بیرون از نقشه» دیده می‌شوند.` : ""));
    } finally { setPending(false); }
  }

  // هنگامِ تایپ کوچک‌تر از خانه‌های استفاده‌شده هم پذیرفته می‌شود («۲» در راهِ «۲۰»)؛ شبکه هرگز آن‌ها را نمی‌بُرد
  const size = (v: string, set: (n: number) => void) => {
    const n = Number(normalize(v));
    if (Number.isInteger(n)) set(Math.min(MAX, Math.max(1, n)));
  };
  const gridCols = Math.max(cols, minCols), gridRows = Math.max(rows, minRows);

  return (
    <div className="grid grid-cols-1 gap-3">
      <Notice tone="warning">ذخیره، چیدمان این انبار را کامل جایگزین می‌کند. پالت‌ها جابه‌جا نمی‌شوند؛ پالتی که جایش پاک شود در «بیرون از نقشه» می‌ماند.</Notice>
      <section className="grid gap-3 rounded-xl border bg-card p-3">
        <div role="radiogroup" aria-label="ابزار" className="flex flex-wrap gap-1.5">
          {TOOLS.map(([t, label]) => (
            <Button key={t} type="button" size="sm" role="radio" aria-checked={tool === t} variant={tool === t ? "default" : "outline"} onClick={() => setTool(t)}>{label}</Button>
          ))}
        </div>
        <div className="grid grid-cols-2 items-start gap-3 sm:grid-cols-4">
          <Field id="le-code" label="ستون" hint="مثلاً A یا 12">
            <Input value={code} maxLength={40} disabled={tool !== "slot"}
              onChange={(e) => { setCode(e.target.value); setNext(String(maxPos([...cells.values()], columnKey(e.target.value)) + 1)); }} />
          </Field>
          <Field id="le-next" label="شماره‌ی بعدی">
            <Input inputMode="numeric" value={next} disabled={tool !== "slot"} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field id="le-cols" label="ستون‌های شبکه">
            <Input type="number" min={minCols} max={MAX} value={cols} onChange={(e) => size(e.target.value, setCols)} onBlur={() => setCols(gridCols)} />
          </Field>
          <Field id="le-rows" label="ردیف‌های شبکه">
            <Input type="number" min={minRows} max={MAX} value={rows} onChange={(e) => size(e.target.value, setRows)} onBlur={() => setRows(gridRows)} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">روی خانه بزنید یا ماوس را روی چند خانه بکشید. با «جای پالت» هر خانه شماره‌ی بعدی همان ستون را می‌گیرد.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <div data-map-scroll className="overflow-auto pb-1">
          <div role="group" aria-label="شبکه‌ی چیدمان" className="grid w-max select-none gap-1" style={{ gridTemplateColumns: `repeat(${gridCols}, 2.75rem)` }}>
            {Array.from({ length: gridRows * gridCols }, (_, i) => {
              const x = i % gridCols, y = Math.floor(i / gridCols), c = cells.get(`${x},${y}`);
              return (
                <button key={`${x},${y}`} type="button" data-cell={`${x},${y}`}
                  aria-label={`خانه‌ی ${num(x + 1)}، ${num(y + 1)}: ${c?.kind === "slot" ? `جای ${slotName(c)}` : c?.kind === "aisle" ? "راهرو" : "خالی"}`}
                  onPointerDown={(e) => { if (e.button === 0) { painting.current = true; apply(x, y); } }}
                  onPointerEnter={() => { if (painting.current) apply(x, y, true); }}
                  onClick={(e) => { if (e.detail === 0) apply(x, y); }}
                  className={cn("flex size-11 items-center justify-center rounded-md border text-[10px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    c?.kind === "slot" ? "border-primary bg-primary/10 font-medium"
                      : c?.kind === "aisle" ? "border-transparent bg-muted [background-image:repeating-linear-gradient(45deg,transparent_0_6px,var(--border)_6px_7px)]"
                        : "border-dashed border-border bg-background")}>
                  {c?.kind === "slot" && slotName(c)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>انصراف</Button>
          <Button type="button" onClick={save} pending={pending}>ذخیره‌ی چیدمان</Button>
        </div>
      </section>
    </div>
  );
}

function maxPos(cells: Cell[], col: string) {
  return Math.max(0, ...cells.filter((c) => c.kind === "slot" && columnKey(c.columnCode!) === columnKey(col || " ")).map((c) => c.positionNo!));
}
