"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/field";
import { CustomerField, type CustomerOption } from "./customer-field";
import { num, type DispatchExtra, type Req } from "./shared";

/**
 * ساخت حواله از درخواست تأییدشده (spec ۳.۷). همه‌ی فیلدها اختیاری‌اند، پس «ثبت حواله» همیشه فعال است.
 * دیالوگ فقط بعد از پاسخ موفق سرور بسته می‌شود؛ در شکست باز می‌ماند و خطا بالای صفحه است.
 */
export function DispatchDialog({
  req, tenantId, pending, onSubmit,
}: { req: Req; tenantId: string; pending: boolean; onSubmit: (extra: DispatchExtra) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState("");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [referenceNumber, setReferenceNumber] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await onSubmit({ destination, customerId: customer?.id, referenceNumber });
    if (ok) { setOpen(false); setDestination(""); setCustomer(null); setReferenceNumber(""); }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogTrigger asChild>
        <Button size="sm" pending={pending && !open}>ساخت حواله</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>ساخت حواله برای {req.agentName}</DialogTitle>
            <DialogDescription>{req.items.map((i) => `${i.name} ×${num(i.qty)}`).join("، ")}</DialogDescription>
          </DialogHeader>
          <Field id={`dest-${req.id}`} label="مقصد (اختیاری)">
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="مثلاً انبار مشتری، تهران" />
          </Field>
          <CustomerField tenantId={tenantId} value={customer} onChange={setCustomer} />
          <Field id={`ref-${req.id}`} label="شماره مرجع (اختیاری)">
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="شماره‌ی دفتر یا مرجع داخلی" />
          </Field>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={pending}>انصراف</Button></DialogClose>
            <Button type="submit" pending={pending}>ثبت حواله</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
