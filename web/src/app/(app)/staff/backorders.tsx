"use client";
import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConfirmButton } from "@/components/confirm-button";
import { DataTable } from "@/components/data-table";
import { Field, NativeSelect } from "@/components/field";
import { CustomerField, type CustomerOption } from "./customer-field";
import { BO_FA, BO_NEXT, num, statusTone, type Agent, type Backorder, type Variant } from "./shared";

export type NewBackorder = {
  agentAccountId: string; variantId: string; quantityBoxes: number;
  destination: string; customerId?: string; referenceNumber: string;
};

/** ثبت کالای ناموجود: حواله‌ی جدا با `fulfillment_type='backorder'`، بیرون از موجودی (قاعده‌ی ۲ CLAUDE.md). */
export function NewBackorderDialog({
  tenantId, agents, variants, pending, onSubmit,
}: {
  tenantId: string; agents: Agent[]; variants: Variant[]; pending: boolean;
  onSubmit: (b: NewBackorder) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [agent, setAgent] = useState("");
  const [variant, setVariant] = useState("");
  const [qty, setQty] = useState("");
  const [destination, setDestination] = useState("");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");
  const [tried, setTried] = useState(false);

  const qtyNum = Number(qty);
  const errors = {
    agent: !agent ? "نمایندگی را انتخاب کنید." : undefined,
    variant: !variant ? "کالا را انتخاب کنید." : undefined,
    qty: !Number.isInteger(qtyNum) || qtyNum < 1 ? "تعداد کارتن باید عدد صحیح بزرگ‌تر از صفر باشد." : undefined,
  };
  const shown: Partial<typeof errors> = tried ? errors : {};

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (errors.agent || errors.variant || errors.qty) return;
    const ok = await onSubmit({ agentAccountId: agent, variantId: variant, quantityBoxes: qtyNum, destination, customerId: customer?.id, referenceNumber });
    if (ok) {
      setOpen(false); setTried(false);
      setQty(""); setDestination(""); setCustomer(null); setReferenceNumber("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>
        <Button><PlusIcon />ثبت کالای ناموجود</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>ثبت کالای ناموجود</DialogTitle>
            <DialogDescription>برای کالایی که موجودی ندارد و باید تولید شود. موجودی انبار عوض نمی‌شود.</DialogDescription>
          </DialogHeader>
          <Field id="bo-agent" label="نمایندگی" error={shown.agent}>
            <NativeSelect value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">انتخاب کنید…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.legalName}</option>)}
            </NativeSelect>
          </Field>
          <Field id="bo-variant" label="کالا" error={shown.variant}>
            <NativeSelect value={variant} onChange={(e) => setVariant(e.target.value)}>
              <option value="">انتخاب کنید…</option>
              {variants.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </NativeSelect>
          </Field>
          <Field id="bo-qty" label="تعداد کارتن" error={shown.qty}>
            <Input type="number" inputMode="numeric" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className="max-w-32" />
          </Field>
          <Field id="bo-destination" label="مقصد (اختیاری)">
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="مثلاً انبار مشتری، تهران" />
          </Field>
          <CustomerField tenantId={tenantId} value={customer} onChange={setCustomer} />
          <Field id="bo-reference" label="شماره مرجع (اختیاری)">
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="شماره‌ی دفتر یا مرجع داخلی" />
          </Field>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={pending}>انصراف</Button></DialogClose>
            <Button type="submit" pending={pending}>ثبت</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BackorderTable({
  rows, pending, onAdvance,
}: { rows: Backorder[]; pending: string | null; onAdvance: (id: string, to: string) => void }) {
  return (
    <DataTable label="کالاهای ناموجود" rows={rows} rowKey={(b) => b.id}
      columns={[
        { key: "item", header: "کالا", cell: (b) => <span>{b.name} <span className="text-xs text-muted-foreground">{b.code}</span></span> },
        { key: "qty", header: "کارتن", className: "tabular-nums", cell: (b) => num(b.qty) },
        { key: "agent", header: "نمایندگی", cell: (b) => b.agentName },
        { key: "dispatch", header: "حواله", cell: (b) => <span className="tabular-nums" dir="ltr">{b.dispatchCode}</span> },
        { key: "status", header: "وضعیت", cell: (b) => <Badge variant={statusTone(b.status)}>{BO_FA[b.status] ?? b.status}</Badge> },
        {
          key: "actions", header: "عملیات", actions: true, className: "md:w-px whitespace-nowrap", cell: (b) => (
            <div className="flex flex-wrap gap-2">
              {(BO_NEXT[b.status] ?? []).map((s) => {
                const busy = pending === "bo" + b.id + s;
                return s === "cancelled" ? (
                  <ConfirmButton key={s} variant="ghost" destructive pending={busy} title="لغو این کالای ناموجود؟"
                    confirmLabel="بله، لغو کن" onConfirm={() => onAdvance(b.id, s)}
                    description={`${b.name} ×${num(b.qty)} برای ${b.agentName} لغو می‌شود. این کار برنمی‌گردد.`}>
                    لغو
                  </ConfirmButton>
                ) : (
                  <Button key={s} size="sm" variant="outline" pending={busy} onClick={() => onAdvance(b.id, s)}>{BO_FA[s]}</Button>
                );
              })}
            </div>
          ),
        },
      ]} />
  );
}
