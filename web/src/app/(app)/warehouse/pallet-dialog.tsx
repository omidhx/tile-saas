"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/field";
import { Notice } from "@/components/states";
import { postJson } from "@/lib/api";
import { lineName, lotLabel, num, palletError, type Pallet } from "./shared";

export type PalletMode = "edit" | "transfer" | "exit";

const TITLE: Record<PalletMode, string> = { edit: "ویرایش پالت", transfer: "انتقال پالت", exit: "خروج کالا (غیرفروش)" };
const EXIT_REASONS = [["waste", "ضایعات"], ["breakage", "شکستگی"], ["sample", "نمونه"], ["internal_use", "مصرف داخلی"], ["other", "سایر"]] as const;
const ADJUST_REASONS = [["count_correction", "اصلاح شمارش"], ["damage", "آسیب"], ["other", "سایر"]] as const;
export const REASON_FA: Record<string, string> = Object.fromEntries([...EXIT_REASONS, ...ADJUST_REASONS]);

const intOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
const isCount = (v: number | null, min = 0) => v !== null && Number.isInteger(v) && v >= min;

/**
 * یک دیالوگ برای سه کار روی یک پالت. ویرایش: محل، یادداشت و تعداد هر ردیف (تغییر تعداد = اصلاح موجودی با دلیل).
 * انتقال: محل تازه؛ اگر فقط بخشی از کارتن‌ها برود، پالت تازه‌ای در مقصد ساخته می‌شود. خروج: کم کردن کارتن با دلیل.
 * سرور همه را زیر قفل موجودی دوباره می‌سنجد؛ این فرم فقط خطای آشکار را زودتر نشان می‌دهد.
 */
export function PalletDialog({
  tenantId, pallet, mode, onClose, onDone,
}: { tenantId: string; pallet: Pallet; mode: PalletMode; onClose: () => void; onDone: (msg: string) => void }) {
  const [col, setCol] = useState(pallet.columnCode ?? "");
  const [pos, setPos] = useState(pallet.positionNo ? String(pallet.positionNo) : "");
  const [note, setNote] = useState(pallet.note ?? "");
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(pallet.lines.map((l) => [l.lotId, mode === "exit" ? "" : String(l.qty)])));
  const [reason, setReason] = useState("");
  const [reasonNote, setReasonNote] = useState("");
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const q = (lotId: string) => intOrNull(qty[lotId] ?? "");
  const changed = mode === "edit" && pallet.lines.some((l) => q(l.lotId) !== l.qty);
  const lineErr = (l: Pallet["lines"][number]) => {
    const v = q(l.lotId);
    if (mode === "exit" && v === null) return undefined;
    if (!isCount(v)) return "عدد صحیح نامنفی";
    if (mode !== "edit" && v! > l.qty) return `حداکثر ${num(l.qty)}`;
    return undefined;
  };
  const posNum = intOrNull(pos);
  const errors = {
    pos: pos.trim() && !isCount(posNum, 1) ? "شماره باید عدد صحیح مثبت باشد." : undefined,
    lines: pallet.lines.some((l) => lineErr(l)) ? "x" : undefined,
    none: mode === "exit" && !pallet.lines.some((l) => (q(l.lotId) ?? 0) > 0) ? "دست‌کم یک ردیف را با تعداد بیشتر از صفر پر کنید." : undefined,
    reason: (mode === "exit" || changed) && !reason ? "دلیل را انتخاب کنید." : undefined,
    reasonNote: (mode === "exit" || changed) && reason === "other" && !reasonNote.trim() ? "برای «سایر» توضیح بنویسید." : undefined,
  };
  const shown: Partial<typeof errors> = tried ? errors : {};

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    const lines = pallet.lines.map((l) => ({ lotId: l.lotId, qty: q(l.lotId) ?? 0 }));
    const body =
      mode === "edit" ? { action: "edit", palletId: pallet.id, columnCode: col, positionNo: posNum, note, lines,
          reason: changed ? reason : null, reasonNote: changed ? reasonNote : null }
      : mode === "transfer" ? { action: "transfer", palletId: pallet.id, columnCode: col, positionNo: posNum, lines }
      : { action: "exit", palletId: pallet.id, lines: lines.filter((l) => l.qty > 0), reason, note: reasonNote };
    setPending(true); setError("");
    try {
      const r = await postJson("/api/pallets", { tenantId, ...body }, "PATCH");
      if (!r.ok) { setError(palletError(r.error, r.status)); return; }
      const newNo = (r.data as { newPalletNo?: number }).newPalletNo;
      onDone(mode === "exit" ? `خروج از پالت ${num(pallet.palletNo)} ثبت شد.`
        : mode === "transfer" ? (newNo ? `بخشی از پالت ${num(pallet.palletNo)} به پالت تازه‌ی ${num(newNo)} منتقل شد.` : `پالت ${num(pallet.palletNo)} منتقل شد.`)
        : `پالت ${num(pallet.palletNo)} ویرایش شد.`);
    } finally { setPending(false); }
  }

  const reasons = mode === "exit" ? EXIT_REASONS : ADJUST_REASONS;
  const qtyLabel = mode === "edit" ? "تعداد کارتن" : mode === "transfer" ? "کارتن برای انتقال" : "کارتن خروجی";

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{TITLE[mode]} {num(pallet.palletNo)}</DialogTitle>
            <DialogDescription>
              {pallet.warehouseName}
              {mode === "transfer" && " · بدون تغییر تعداد همه‌ی پالت جابه‌جا می‌شود؛ با کم کردن تعداد، همان کارتن‌ها پالت تازه‌ای در مقصد می‌شوند."}
              {mode === "edit" && " · تغییر تعداد یعنی اصلاح موجودی و با دلیل در لاگ ثبت می‌شود."}
            </DialogDescription>
          </DialogHeader>

          {mode !== "exit" && (
            <div className="grid grid-cols-2 gap-3">
              <Field id="pd-col" label={mode === "transfer" ? "ستون مقصد" : "ستون"} hint="خالی یعنی بدون محل">
                <Input value={col} onChange={(e) => setCol(e.target.value)} maxLength={40} />
              </Field>
              <Field id="pd-pos" label="شماره" error={shown.pos}>
                <Input inputMode="numeric" value={pos} onChange={(e) => setPos(e.target.value)} />
              </Field>
            </div>
          )}

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{qtyLabel}</legend>
            {pallet.lines.map((l) => (
              <div key={l.lotId} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 rounded-lg border p-2">
                <div className="min-w-0 text-sm">
                  <div className="truncate font-medium">{lineName(l)}</div>
                  <div className="truncate text-xs text-muted-foreground">{[lotLabel(l), `روی پالت: ${num(l.qty)}`].filter(Boolean).join(" · ")}</div>
                </div>
                <Field id={`pd-q-${l.lotId}`} label={<span className="sr-only">{qtyLabel} {lineName(l)}</span>} error={tried ? lineErr(l) : undefined}>
                  <Input inputMode="numeric" value={qty[l.lotId] ?? ""} placeholder={mode === "exit" ? "۰" : undefined}
                    onChange={(e) => setQty((s) => ({ ...s, [l.lotId]: e.target.value }))} />
                </Field>
              </div>
            ))}
            {shown.none && <p className="text-xs text-destructive">{shown.none}</p>}
          </fieldset>

          {(mode === "exit" || changed) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="pd-reason" label="دلیل" error={shown.reason}>
                <NativeSelect value={reason} onChange={(e) => setReason(e.target.value)}>
                  <option value="">انتخاب کنید</option>
                  {reasons.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </NativeSelect>
              </Field>
              <Field id="pd-rnote" label="توضیح" error={shown.reasonNote}>
                <Input value={reasonNote} onChange={(e) => setReasonNote(e.target.value)} maxLength={200} />
              </Field>
            </div>
          )}
          {mode === "edit" && (
            <Field id="pd-note" label="یادداشت پالت">
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
            </Field>
          )}

          {error && <Notice tone="error">{error}</Notice>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={pending}>انصراف</Button></DialogClose>
            <Button type="submit" pending={pending} variant={mode === "exit" ? "destructive" : "default"}>
              {mode === "exit" ? "ثبت خروج" : mode === "transfer" ? "انتقال" : "ذخیره"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
