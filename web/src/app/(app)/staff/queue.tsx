"use client";
import Link from "next/link";
import { ClockIcon, PrinterIcon, WarehouseIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/states";
import { remainingTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import { DispatchDialog } from "./dispatch-dialog";
import { DISPATCH_FA, DISPATCH_NEXT, itemLine, num, statusTone, type Disp, type DispatchExtra, type Req, type Resv } from "./shared";

/** یک مرحله از زنجیره: عنوان با شمارش، و جدول یا «چیزی نیست». */
export function Lane({
  title, count, children, empty, hint,
}: { title: string; count: number; children: React.ReactNode; empty: string; hint?: string }) {
  return (
    // روی موبایل خود ردیف‌ها کارت‌اند؛ قاب دور مرحله فقط یک لایه‌ی تودرتوی اضافه بود.
    <section className="grid grid-cols-1 gap-2 md:rounded-xl md:border md:bg-card md:p-4" aria-label={title}>
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {title}
        <Badge variant={count > 0 ? "warning" : "secondary"} className="tabular-nums">{num(count)}</Badge>
        {hint && <span className="ms-auto text-xs font-normal text-muted-foreground">{hint}</span>}
      </h2>
      {count === 0 ? <EmptyState>{empty}</EmptyState> : children}
    </section>
  );
}

function Agent({ name, staff, fresh }: { name: string; staff: string | null; fresh: boolean }) {
  return (
    <div className="grid gap-0.5">
      <span className="flex items-center gap-1.5 font-medium">
        {name}
        {fresh && <Badge variant="warning">تازه</Badge>}
      </span>
      {/* پشتیبان ثابت این نمایندگی: پورسانت این سفارش با کیست */}
      {staff && <span className="text-xs text-muted-foreground">پشتیبان: {staff}</span>}
    </div>
  );
}

export function ReservationTable({
  rows, fresh, pending, onApprove, onCancel,
}: {
  rows: Resv[]; fresh: Set<string>; pending: string | null;
  onApprove: (id: string) => void; onCancel: (id: string) => void;
}) {
  return (
    <DataTable label="رزروهای در انتظار تأیید" testId="pending-reservations" rows={rows} rowKey={(r) => r.id}
      rowClassName={(r) => (fresh.has(r.id) ? "bg-warning/8" : undefined)}
      columns={[
        { key: "agent", header: "نمایندگی", cell: (r) => <Agent name={r.agentName} staff={r.assignedStaffName ?? r.assignedStaffPhone} fresh={fresh.has(r.id)} /> },
        {
          key: "items", header: "اقلام", cell: (r) => (
            <ul className="grid gap-0.5">
              {r.items.map((i, k) => {
                const l = itemLine(i);
                return <li key={k}>{l.main}{l.extra && <span className="text-xs text-muted-foreground"> ({l.extra})</span>}</li>;
              })}
            </ul>
          ),
        },
        {
          key: "expires", header: "مهلت", className: "whitespace-nowrap", cell: (r) => {
            // صف با زودترین انقضا مرتب است؛ عدد مهلت دلیل ترتیب را نشان می‌دهد.
            const rem = remainingTime(r.expiresAt);
            return (
              <span className={cn("inline-flex items-center gap-1", rem.low ? "font-medium text-destructive" : "text-muted-foreground")}>
                <ClockIcon className="size-3.5" aria-hidden="true" />{rem.text}{!rem.low && " مانده"}
              </span>
            );
          },
        },
        {
          key: "actions", header: "عملیات", actions: true, className: "md:w-px whitespace-nowrap", cell: (r) => (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onApprove(r.id)} pending={pending === "approve" + r.id}>تأیید</Button>
              <ConfirmButton variant="ghost" destructive pending={pending === "cancel" + r.id}
                title="لغو این رزرو؟" confirmLabel="بله، لغو کن" onConfirm={() => onCancel(r.id)}
                description={`رزرو ${r.agentName} لغو می‌شود و موجودی آن آزاد می‌شود. این کار برنمی‌گردد.`}>
                لغو
              </ConfirmButton>
            </div>
          ),
        },
      ]} />
  );
}

export function RequestTable({
  rows, fresh, tenantId, pending, onMakeDispatch,
}: {
  rows: Req[]; fresh: Set<string>; tenantId: string; pending: string | null;
  onMakeDispatch: (id: string, extra: DispatchExtra) => Promise<boolean>;
}) {
  return (
    <DataTable label="درخواست‌های آماده‌ی حواله" testId="approved-requests" rows={rows} rowKey={(r) => r.id}
      rowClassName={(r) => (fresh.has(r.id) ? "bg-warning/8" : undefined)}
      columns={[
        { key: "agent", header: "نمایندگی", cell: (r) => <Agent name={r.agentName} staff={r.assignedStaffName ?? r.assignedStaffPhone} fresh={fresh.has(r.id)} /> },
        { key: "items", header: "اقلام", cell: (r) => r.items.map((i) => `${i.name} ×${num(i.qty)}`).join("، ") },
        {
          // پشتیبان باید ببیند کدام سفارش بدون او تأیید شده، وگرنه تأیید خودکار بی‌صدا کار می‌کند.
          key: "mode", header: "تأیید", className: "whitespace-nowrap",
          cell: (r) => r.approvalMode === "auto" ? <Badge variant="success">خودکار (زیر سقف)</Badge> : <span className="text-muted-foreground">دستی</span>,
        },
        {
          key: "actions", header: "عملیات", actions: true, className: "md:w-px whitespace-nowrap",
          cell: (r) => <DispatchDialog req={r} tenantId={tenantId} pending={pending === r.id} onSubmit={(x) => onMakeDispatch(r.id, x)} />,
        },
      ]} />
  );
}

/** دکمه‌های وضعیت بعدی یک حواله. بارگیری (موجودی کم می‌شود) و لغو تأیید می‌خواهند. */
export function DispatchActions({
  d, pending, onAdvance, withCancel = true,
}: { d: Disp; pending: string | null; onAdvance: (id: string, to: string) => void; withCancel?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2 md:flex-nowrap">
      {(DISPATCH_NEXT[d.status] ?? []).filter((s) => withCancel || s !== "cancelled").map((s) => {
        const busy = pending === d.id + s;
        if (s === "loaded")
          return (
            <ConfirmButton key={s} variant="default" pending={busy} title={`بارگیری حواله‌ی ${d.dispatchCode}`}
              confirmLabel="بله، بارگیری شد" onConfirm={() => onAdvance(d.id, s)}
              description={`${num(d.items)} قلم از موجودی${d.warehouseName ? ` ${d.warehouseName}` : ""} کم می‌شود. این کار برنمی‌گردد.`}>
              ثبت بارگیری
            </ConfirmButton>
          );
        if (s === "cancelled")
          return (
            <ConfirmButton key={s} variant="ghost" destructive pending={busy} title={`لغو حواله‌ی ${d.dispatchCode}؟`}
              confirmLabel="بله، لغو کن" onConfirm={() => onAdvance(d.id, s)}
              description="تخصیص این حواله آزاد می‌شود و حواله دوباره ساخته نمی‌شود. این کار برنمی‌گردد.">
              لغو
            </ConfirmButton>
          );
        return (
          <Button key={s} size="sm" variant="outline" pending={busy} onClick={() => onAdvance(d.id, s)}>
            {s === "delivered" ? "تحویل شد" : DISPATCH_FA[s]}
          </Button>
        );
      })}
      {/* انباردار روی کاغذ کار می‌کند؛ برگه‌ی چاپی همیشه در دسترس است. */}
      <Button asChild size="sm" variant="ghost">
        <Link href={`/staff/dispatch/${d.id}/print`} target="_blank" aria-label={`چاپ حواله‌ی ${d.dispatchCode}`}>
          <PrinterIcon />چاپ
        </Link>
      </Button>
    </div>
  );
}

export function DispatchTable({
  rows, pending, onAdvance, withCancel, label, testId,
}: {
  rows: Disp[]; pending: string | null; onAdvance: (id: string, to: string) => void;
  withCancel?: boolean; label: string; testId?: string;
}) {
  return (
    <DataTable label={label} testId={testId} rows={rows} rowKey={(d) => d.id}
      columns={[
        {
          key: "code", header: "حواله", className: "whitespace-nowrap", cell: (d) => (
            <div className="grid gap-0.5">
              <span className="justify-self-start font-medium tabular-nums" dir="ltr">{d.dispatchCode}</span>
              {/* انباردار باید با یک نگاه بفهمد این حواله مال انبار اوست */}
              {d.warehouseName && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><WarehouseIcon className="size-3" aria-hidden="true" />{d.warehouseName}</span>}
            </div>
          ),
        },
        {
          key: "customer", header: "مشتری و مقصد", cell: (d) => (
            <div className="grid gap-0.5">
              <span>{d.customerName ?? <span className="text-muted-foreground">—</span>}</span>
              {(d.destination || d.referenceNumber) && (
                <span className="text-xs text-muted-foreground">
                  {[d.destination && `مقصد: ${d.destination}`, d.referenceNumber && `مرجع: ${d.referenceNumber}`].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
          ),
        },
        { key: "items", header: "اقلام", className: "whitespace-nowrap tabular-nums", cell: (d) => `${num(d.items)} قلم` },
        { key: "status", header: "وضعیت", cell: (d) => <Badge variant={statusTone(d.status)} data-status>{DISPATCH_FA[d.status] ?? d.status}</Badge> },
        {
          key: "actions", header: "عملیات", actions: true, className: "md:w-px whitespace-nowrap",
          cell: (d) => <DispatchActions d={d} pending={pending} onAdvance={onAdvance} withCancel={withCancel} />,
        },
      ]} />
  );
}
