"use client";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { CopyPlusIcon, LayersIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/field";
import { LoadingState, Notice } from "@/components/states";
import { getJson, postJson } from "@/lib/api";
import { normalize } from "@/lib/search";
import { useContexts, type Ctx } from "@/lib/useContexts";
import { num, palletError, useDebounced, useWarehouses } from "../shared";

/**
 * ورود کالا (فاز ۷): چند پالت در یک فرم؛ هر پالت محل (ستون، شماره)، «تکرار ×n» و یک یا چند ردیف کالا.
 * چند ردیف روی یک پالت = پالت ترکیبی (مثلاً ۶۶ کارتن درجه ۲ و ۳۰ کارتن درجه ۳). پالت‌های تکراری شماره‌های
 * پشت‌سرِهم می‌گیرند. Lot با کالا + بچ + شید + کالیبر پیدا یا ساخته می‌شود، مثل ایمپورت اکسل.
 */
export default function GoodsInPage() {
  const { ctx, state } = useContexts("staff");
  if (state === "none") return <div className="p-4"><Notice tone="error">این بخش فقط برای پشتیبان است.</Notice></div>;
  if (!ctx) return <div className="p-4"><LoadingState /></div>;
  return <GoodsIn ctx={ctx} />;
}

type Variant = { id: string; name: string; code: string; sku: string; grade: string | null; boxesPerPallet: number | null };
type Line = { key: number; variant: Variant | null; text: string; batch: string; shade: string; caliber: string; qty: string };
type PalletForm = { key: number; col: string; pos: string; repeat: string; note: string; lines: Line[] };

let seq = 0;
const newLine = (): Line => ({ key: ++seq, variant: null, text: "", batch: "", shade: "", caliber: "", qty: "" });
const newPallet = (): PalletForm => ({ key: ++seq, col: "", pos: "", repeat: "1", note: "", lines: [newLine()] });
const label = (v: Variant) => `${v.code} — ${v.name}${v.grade ? ` — درجه ${v.grade}` : ""}`;
const toInt = (s: string) => (s.trim() === "" ? null : Number(normalize(s)));
const posInt = (s: string, max: number) => { const v = toInt(s); return v !== null && Number.isInteger(v) && v >= 1 && v <= max ? v : null; };

function GoodsIn({ ctx }: { ctx: Ctx }) {
  const tenantId = ctx.tenantId;
  const warehouses = useWarehouses(tenantId);
  const [wh, setWh] = useState("");
  const [pallets, setPallets] = useState<PalletForm[]>(() => [newPallet()]);
  const [options, setOptions] = useState<Variant[]>([]);
  const [search, setSearch] = useState("");
  const dsearch = useDebounced(search);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ nos: number[]; boxes: number } | null>(null);
  const listId = useId();

  useEffect(() => { if (!wh && warehouses.length === 1) setWh(warehouses[0].id); }, [warehouses, wh]);
  useEffect(() => {
    void getJson<{ variants: Variant[] }>(`/api/catalog?tenantId=${tenantId}${dsearch.trim() ? `&q=${encodeURIComponent(dsearch.trim())}` : ""}`)
      .then((r) => { if (r.ok) setOptions((old) => [...new Map([...old, ...r.data.variants].map((v) => [v.id, v])).values()]); });
  }, [tenantId, dsearch]);

  const setP = (k: number, f: (p: PalletForm) => PalletForm) => setPallets((ps) => ps.map((p) => (p.key === k ? f(p) : p)));
  const setL = (pk: number, lk: number, patch: Partial<Line>) =>
    setP(pk, (p) => ({ ...p, lines: p.lines.map((l) => (l.key === lk ? { ...l, ...patch } : l)) }));

  const lineErrors = (l: Line) => ({
    variant: !l.variant ? "کالا را از فهرست انتخاب کنید." : undefined,
    qty: posInt(l.qty, 100_000) === null ? "تعداد کارتن: عدد صحیح ۱ تا ۱۰۰٬۰۰۰" : undefined,
  });
  const palletErrors = (p: PalletForm) => ({
    repeat: posInt(p.repeat, 200) === null ? "۱ تا ۲۰۰" : undefined,
    pos: p.pos.trim() && posInt(p.pos, 100_000) === null ? "عدد صحیح مثبت" : undefined,
  });
  const anyError = !wh || pallets.some((p) => Object.values(palletErrors(p)).some(Boolean) || p.lines.some((l) => Object.values(lineErrors(l)).some(Boolean)));
  const totalPallets = pallets.reduce((s, p) => s + (posInt(p.repeat, 200) ?? 0), 0);
  const totalBoxes = pallets.reduce((s, p) => s + (posInt(p.repeat, 200) ?? 0) * p.lines.reduce((t, l) => t + (posInt(l.qty, 100_000) ?? 0), 0), 0);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true); setError(""); setDone(null);
    if (anyError) return;
    setPending(true);
    try {
      const r = await postJson("/api/pallets", {
        tenantId, warehouseId: wh,
        pallets: pallets.map((p) => ({
          columnCode: p.col.trim() || null, positionNo: posInt(p.pos, 100_000), repeat: posInt(p.repeat, 200), note: p.note.trim() || null,
          lines: p.lines.map((l) => ({ variantId: l.variant!.id, batchNumber: l.batch.trim() || null, shadeCode: l.shade.trim() || null,
            caliberCode: l.caliber.trim() || null, qty: posInt(l.qty, 100_000) })),
        })),
      });
      if (!r.ok) { setError(palletError(r.error, r.status)); return; }
      setDone({ nos: (r.data as { palletNos: number[] }).palletNos, boxes: totalBoxes });
      setPallets([newPallet()]); setTried(false);
    } finally { setPending(false); }
  }

  return (
    <AppShell ctx={ctx} title="ورود کالا" subtitle="ثبت پالت‌های تازه با محل؛ موجودی همان لحظه بالا می‌رود.">
      <form onSubmit={submit} noValidate className="grid max-w-4xl grid-cols-1 gap-4">
        {done && (
          <Notice tone="success" action={<Button size="xs" variant="outline" asChild><Link href="/warehouse">لیست انبار</Link></Button>}>
            {num(done.nos.length)} پالت با {num(done.boxes)} کارتن ثبت شد. شماره‌ی پالت‌ها: {done.nos.map(num).join("، ")}
          </Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}

        <div className="max-w-xs">
          <Field id="gi-wh" label="انبار" error={tried && !wh ? "انبار را انتخاب کنید." : undefined}>
            <NativeSelect value={wh} onChange={(e) => setWh(e.target.value)}>
              <option value="">انتخاب کنید</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </NativeSelect>
          </Field>
        </div>

        <datalist id={listId}>{options.map((v) => <option key={v.id} value={label(v)} />)}</datalist>

        {pallets.map((p, pi) => {
          const pe: Partial<ReturnType<typeof palletErrors>> = tried ? palletErrors(p) : {};
          const rep = posInt(p.repeat, 200) ?? 1;
          const start = posInt(p.pos, 100_000);
          return (
            <section key={p.key} aria-label={`پالت ${num(pi + 1)}`} className="grid gap-3 rounded-xl border bg-card p-3 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <LayersIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  پالت {num(pi + 1)}{p.lines.length > 1 && <span className="text-xs font-normal text-muted-foreground">(ترکیبی، {num(p.lines.length)} ردیف)</span>}
                </h2>
                {pallets.length > 1 && (
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`حذف پالت ${num(pi + 1)}`}
                    onClick={() => setPallets((ps) => ps.filter((x) => x.key !== p.key))}><Trash2Icon /></Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field id={`gi-col-${p.key}`} label="ستون" hint="خالی = بدون محل">
                  <Input value={p.col} maxLength={40} onChange={(e) => setP(p.key, (x) => ({ ...x, col: e.target.value }))} />
                </Field>
                <Field id={`gi-pos-${p.key}`} label="شماره" error={pe.pos}
                  hint={rep > 1 && start ? `شماره‌های ${num(start)} تا ${num(start + rep - 1)}` : undefined}>
                  <Input inputMode="numeric" value={p.pos} onChange={(e) => setP(p.key, (x) => ({ ...x, pos: e.target.value }))} />
                </Field>
                <Field id={`gi-rep-${p.key}`} label="تکرار ×n" error={pe.repeat} hint="تعداد پالت یکسان">
                  <Input inputMode="numeric" value={p.repeat} onChange={(e) => setP(p.key, (x) => ({ ...x, repeat: e.target.value }))} />
                </Field>
                <Field id={`gi-note-${p.key}`} label="یادداشت">
                  <Input value={p.note} maxLength={200} onChange={(e) => setP(p.key, (x) => ({ ...x, note: e.target.value }))} />
                </Field>
              </div>

              {p.lines.map((l, li) => {
                const le: Partial<ReturnType<typeof lineErrors>> = tried ? lineErrors(l) : {};
                return (
                  <div key={l.key} className="grid gap-3 rounded-lg bg-muted/40 p-2.5 sm:grid-cols-[minmax(0,2.4fr)_repeat(3,minmax(0,1fr))_minmax(0,1fr)_auto] sm:items-start">
                    <Field id={`gi-v-${l.key}`} label={`کالا${p.lines.length > 1 ? ` ${num(li + 1)}` : ""}`} error={le.variant}>
                      <Input list={listId} value={l.text} autoComplete="off" placeholder="کد یا نام کالا"
                        onChange={(e) => {
                          const text = e.target.value;
                          setSearch(text);
                          setL(p.key, l.key, { text, variant: options.find((v) => label(v) === text) ?? null });
                        }} />
                    </Field>
                    <Field id={`gi-b-${l.key}`} label="بچ"><Input value={l.batch} onChange={(e) => setL(p.key, l.key, { batch: e.target.value })} /></Field>
                    <Field id={`gi-s-${l.key}`} label="شید"><Input value={l.shade} onChange={(e) => setL(p.key, l.key, { shade: e.target.value })} /></Field>
                    <Field id={`gi-c-${l.key}`} label="کالیبر"><Input value={l.caliber} onChange={(e) => setL(p.key, l.key, { caliber: e.target.value })} /></Field>
                    <Field id={`gi-q-${l.key}`} label="کارتن" error={le.qty}
                      hint={l.variant?.boxesPerPallet ? `پالت کامل: ${num(l.variant.boxesPerPallet)}` : undefined}>
                      <Input inputMode="numeric" value={l.qty} onChange={(e) => setL(p.key, l.key, { qty: e.target.value })} />
                    </Field>
                    {p.lines.length > 1 ? (
                      <Button type="button" size="icon-sm" variant="ghost" className="sm:mt-6" aria-label={`حذف ردیف ${num(li + 1)}`}
                        onClick={() => setP(p.key, (x) => ({ ...x, lines: x.lines.filter((y) => y.key !== l.key) }))}><Trash2Icon /></Button>
                    ) : <span className="hidden sm:block sm:w-7" />}
                  </div>
                );
              })}
              <div>
                <Button type="button" size="sm" variant="outline" onClick={() => setP(p.key, (x) => ({ ...x, lines: [...x.lines, newLine()] }))}>
                  <PlusIcon />درجه یا کالای دیگر روی همین پالت
                </Button>
              </div>
            </section>
          );
        })}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setPallets((ps) => [...ps, newPallet()])}><CopyPlusIcon />پالت دیگر</Button>
          <div className="ms-auto text-sm text-muted-foreground tabular-nums" aria-live="polite">جمع: {num(totalPallets)} پالت · {num(totalBoxes)} کارتن</div>
          <Button type="submit" pending={pending}>ثبت ورود</Button>
        </div>
      </form>
    </AppShell>
  );
}
