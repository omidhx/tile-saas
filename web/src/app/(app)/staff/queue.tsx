"use client";
import Link from "next/link";
import {
  CheckIcon, ClockIcon, FilePlus2Icon, HourglassIcon, PackageCheckIcon, PrinterIcon, SquareIcon, TriangleAlertIcon,
  TruckIcon, UserIcon, WarehouseIcon, ZapIcon, type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/confirm-button";
import { DataTable } from "@/components/data-table";
import { remainingTime } from "@/lib/date";
import { cn } from "@/lib/utils";
import { DispatchDialog } from "./dispatch-dialog";
import {
  DISPATCH_FA, DISPATCH_NEXT, itemLine, num, statusTone,
  type DashboardKpis, type Disp, type DispatchExtra, type Req, type Resv,
} from "./shared";

/** مرحله‌های کارتابل به ترتیب کار؛ رنگ هر مرحله روی کارت عدد و لبه‌ی ردیف یکی است. */
export type Stage = "all" | "approve" | "dispatch" | "load";
// chip: متن تیره‌تر از رنگ لبه تا روی زمینه‌ی کم‌رنگ هم ۴.۵:۱ بدهد، در هر دو تم (axe color-contrast).
const STAGE: Record<Exclude<Stage, "all">, { label: string; color: string; icon: LucideIcon; chip: string }> = {
  approve: { label: "تأیید رزرو", color: "#d97706", icon: HourglassIcon, chip: "bg-amber-500/12 text-amber-800 dark:text-amber-300" },
  dispatch: { label: "ساخت حواله", color: "#0d9488", icon: FilePlus2Icon, chip: "bg-teal-500/12 text-teal-800 dark:text-teal-300" },
  load: { label: "بارگیری", color: "#2563eb", icon: TruckIcon, chip: "bg-blue-500/12 text-blue-800 dark:text-blue-300" },
};

// ---------- اجزای کوچک ----------

/** رنگ ثابت هر نمایندگی از روی نامش؛ همه با متن سفید کنتراست ≥ ۴.۵ دارند. */
const AVATAR = ["#0f766e", "#6d28d9", "#c2410c", "#1d4ed8", "#be123c", "#047857"];
function Avatar({ name }: { name: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const initial = name.replace(/^نمایندگی\s*/, "").trim().charAt(0);
  return (
    <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
      style={{ background: AVATAR[h % AVATAR.length] }}>{initial}</span>
  );
}

/** تامنیل کاشی؛ بدون عکس، جای خالی هم‌اندازه تا ردیف‌ها هم‌تراز بمانند. */
function Thumb({ src }: { src: string | null }) {
  return src
    // img ساده، نه next/image: عکس آپلودشده یا آدرس ایمپورت است و بهینه‌سازی سرور لازم نیست
    ? <img src={src} alt="" loading="lazy" className="size-9 shrink-0 rounded-lg object-cover ring-1 ring-border" />
    : <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground ring-1 ring-border"><SquareIcon className="size-4" /></span>;
}

function Lines({ lines }: { lines: { name: string; qty: number; extra?: string; image: string | null }[] }) {
  return (
    <ul className="grid gap-2">
      {lines.map((l, i) => (
        <li key={i} className="flex items-center gap-2.5">
          <Thumb src={l.image} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13px] font-medium">{l.name}</div>
            {l.extra && <div className="text-[11px] text-muted-foreground">{l.extra}</div>}
          </div>
          <span className="text-[13px] font-bold tabular-nums">×{num(l.qty)}</span>
        </li>
      ))}
    </ul>
  );
}

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "همین حالا";
  if (m < 60) return `${num(m)} دقیقه پیش`;
  if (m < 1440) return `${num(Math.floor(m / 60))} ساعت پیش`;
  return `${num(Math.floor(m / 1440))} روز پیش`;
}

/** مهلت رزرو با نوار؛ ۲۴ ساعت = پر (همان TTL پیش‌فرض CLAUDE.md). */
function Deadline({ expiresAt }: { expiresAt: string }) {
  const rem = remainingTime(expiresAt);
  const pct = Math.max(3, Math.min(100, ((new Date(expiresAt).getTime() - Date.now()) / 864e5) * 100));
  return (
    <div className="grid w-full gap-1">
      <span className={cn("inline-flex items-center gap-1 text-[12px]", rem.low ? "font-semibold text-destructive" : "text-muted-foreground")}>
        <ClockIcon className="size-3.5" aria-hidden="true" />{rem.text}{!rem.low && " تا انقضا"}
      </span>
      <span aria-hidden="true" className="h-1 overflow-hidden rounded-full bg-muted">
        <span className={cn("block h-full rounded-full", rem.low ? "bg-destructive" : pct < 50 ? "bg-warning" : "bg-primary")} style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}

/** ردیف کارتابل: لبه‌ی رنگی مرحله، نمایندگی، اقلام، اطلاعات و دکمه‌ی کار بعدی در یک خط. */
function Row({
  stage, agent, chips, lines, body, info, actions, fresh,
}: {
  stage: Exclude<Stage, "all">; agent: string; chips: React.ReactNode;
  lines?: React.ComponentProps<typeof Lines>["lines"]; body?: React.ReactNode;
  info?: React.ReactNode; actions: React.ReactNode; fresh?: boolean;
}) {
  return (
    <article data-row className={cn("relative flex flex-wrap items-center gap-x-5 gap-y-3 overflow-hidden rounded-xl border bg-card p-3 ps-4 shadow-xs",
      fresh && "ring-2 ring-warning/40")}>
      <span aria-hidden="true" className="absolute inset-y-0 start-0 w-1" style={{ background: STAGE[stage].color }} />
      <div className="flex w-52 items-center gap-2.5">
        <Avatar name={agent} />
        <div className="grid min-w-0 gap-1 leading-tight">
          <span className="truncate text-[13px] font-semibold">{agent}</span>
          <span className="flex flex-wrap gap-1">{chips}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 basis-56">{lines ? <Lines lines={lines} /> : body}</div>
      {info && <div className="flex w-40 items-center max-md:w-full">{info}</div>}
      <div className="flex shrink-0 gap-2 max-md:w-full max-md:[&>*]:flex-1">{actions}</div>
    </article>
  );
}

const StageBadge = ({ stage }: { stage: Exclude<Stage, "all"> }) => (
  <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", STAGE[stage].chip)}>{STAGE[stage].label}</span>
);

// ---------- کارت‌های عدد (فیلتر مرحله) ----------

export function KpiCards({
  stage, onStage, counts, subs, todayBoxes, todayDispatches, failed,
}: {
  stage: Stage; onStage: (s: Stage) => void; counts: Record<Exclude<Stage, "all">, number>;
  subs: Record<Exclude<Stage, "all">, string>; todayBoxes?: number; todayDispatches?: number; failed: boolean;
}) {
  const card = "grid gap-2 rounded-xl border bg-card p-4 text-start shadow-xs";
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {(Object.keys(STAGE) as (keyof typeof STAGE)[]).map((k) => {
        const { label, color, icon: Icon } = STAGE[k];
        const on = stage === k;
        return (
          <button key={k} type="button" aria-pressed={on} onClick={() => onStage(on ? "all" : k)}
            className={cn(card, "outline-none transition hover:border-foreground/20 focus-visible:ring-3 focus-visible:ring-ring/50", on && "ring-2 ring-primary")}>
            <span className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
              <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg" style={{ background: color + "1a", color }}><Icon className="size-4" /></span>
            </span>
            <span className="text-2xl font-bold tabular-nums">{failed ? "—" : num(counts[k])}</span>
            <span className="text-[11px] text-muted-foreground">{failed ? "بارگذاری نشد" : subs[k]}</span>
          </button>
        );
      })}
      <div className={card}>
        <span className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-muted-foreground">بارگیری امروز</span>
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-success/10 text-success"><PackageCheckIcon className="size-4" /></span>
        </span>
        <span className="text-2xl font-bold tabular-nums">{todayBoxes == null ? "—" : num(todayBoxes)}</span>
        <span className="text-[11px] text-muted-foreground">{todayDispatches == null ? "" : `کارتن، در ${num(todayDispatches)} حواله`}</span>
      </div>
    </div>
  );
}

// ---------- فهرست کارهای باز ----------

export function WorkList({
  stage, resvs, reqs, toLoad, freshResv, freshReq, tenantId, pending, rowPending, onApprove, onCancel, onMakeDispatch, onAdvance,
}: {
  stage: Stage; resvs: Resv[]; reqs: Req[]; toLoad: Disp[]; freshResv: Set<string>; freshReq: Set<string>; tenantId: string;
  pending: string | null; rowPending: string | null;
  onApprove: (id: string) => void; onCancel: (id: string) => void;
  onMakeDispatch: (id: string, extra: DispatchExtra) => Promise<string>; onAdvance: (id: string, to: string) => void;
}) {
  const show = (s: Exclude<Stage, "all">) => stage === "all" || stage === s;
  return (
    <div className="grid gap-2.5">
      {show("approve") && resvs.length > 0 && (
        <div className="grid gap-2.5" data-testid="pending-reservations">
          {resvs.map((r) => (
            <Row key={r.id} stage="approve" agent={r.agentName} fresh={freshResv.has(r.id)}
              chips={<><StageBadge stage="approve" />{freshResv.has(r.id) && <Badge variant="warning">تازه</Badge>}</>}
              lines={r.items.map((i) => ({ name: i.name, qty: i.quantityBoxes, extra: itemLine(i).extra, image: i.imageUrl }))}
              info={<Deadline expiresAt={r.expiresAt} />}
              actions={<>
                <Button size="sm" onClick={() => onApprove(r.id)} pending={pending === "approve" + r.id}><CheckIcon />تأیید</Button>
                <ConfirmButton variant="ghost" destructive pending={pending === "cancel" + r.id}
                  title="لغو این رزرو؟" confirmLabel="بله، لغو کن" onConfirm={() => onCancel(r.id)}
                  description={`رزرو ${r.agentName} لغو می‌شود و موجودی آن آزاد می‌شود. این کار برنمی‌گردد.`}>لغو</ConfirmButton>
              </>} />
          ))}
        </div>
      )}
      {show("dispatch") && reqs.length > 0 && (
        <div className="grid gap-2.5" data-testid="approved-requests">
          {reqs.map((r) => (
            <Row key={r.id} stage="dispatch" agent={r.agentName} fresh={freshReq.has(r.id)}
              chips={<>
                {r.approvalMode === "auto"
                  ? <Badge variant="success"><ZapIcon />تأیید خودکار</Badge>
                  : <StageBadge stage="dispatch" />}
                {freshReq.has(r.id) && <Badge variant="warning">تازه</Badge>}
              </>}
              lines={r.items.map((i) => ({ name: i.name, qty: i.qty, image: i.imageUrl }))}
              info={<span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                <ClockIcon className="size-3.5" aria-hidden="true" />{r.createdAt ? `تأیید ${ago(r.createdAt)}` : "منتظر حواله"}
                {(r.assignedStaffName || r.assignedStaffPhone) && <><br />پشتیبان: {r.assignedStaffName ?? r.assignedStaffPhone}</>}
              </span>}
              actions={<DispatchDialog req={r} tenantId={tenantId} pending={rowPending === r.id} onSubmit={(x) => onMakeDispatch(r.id, x)} />} />
          ))}
        </div>
      )}
      {show("load") && toLoad.length > 0 && (
        <div className="grid gap-2.5" data-testid="to-load">
          {toLoad.map((d) => (
            <Row key={d.id} stage="load" agent={d.agentName ?? d.customerName ?? "—"}
              chips={<Badge variant={statusTone(d.status)} data-status>{DISPATCH_FA[d.status] ?? d.status}</Badge>}
              body={<div className="grid gap-1 text-[12px] text-muted-foreground">
                <span dir="ltr" className="justify-self-start font-mono text-sm font-semibold text-foreground">{d.dispatchCode}</span>
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {d.warehouseName && <span className="inline-flex items-center gap-1"><WarehouseIcon className="size-3.5" aria-hidden="true" />{d.warehouseName}</span>}
                  <span>{num(d.items)} قلم</span>
                  <span className="inline-flex items-center gap-1"><UserIcon className="size-3.5" aria-hidden="true" />{d.customerName ?? "مشتری ثبت نشده"}</span>
                  {d.destination && <span>مقصد: {d.destination}</span>}
                </span>
              </div>}
              actions={<DispatchActions d={d} pending={pending} onAdvance={onAdvance} />} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- ستون کناری ----------

export function LowStockCard({ kpis }: { kpis: DashboardKpis | null }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs" aria-label="رو به اتمام">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
        <TriangleAlertIcon className="size-4 text-warning" aria-hidden="true" />رو به اتمام
        <span className="ms-auto text-[11px] font-normal text-muted-foreground">کارتن قابل‌فروش</span>
      </h2>
      {!kpis ? <p className="text-[13px] text-muted-foreground">—</p>
        : kpis.lowStock.length === 0 ? <p className="text-[13px] text-muted-foreground">کالای کم‌موجودی نیست.</p>
        : (
          <ul className="grid gap-2.5">
            {kpis.lowStock.map((v) => (
              <li key={v.variantId} className="flex items-center gap-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate">{v.name} <span className="text-[11px] text-muted-foreground">{v.code}</span></span>
                <span className="font-bold tabular-nums text-warning">{num(v.available)}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

export function RecentDispatchesCard({ recent, onShowAll }: { recent: Disp[]; onShowAll: () => void }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-xs" aria-label="آخرین حواله‌ها">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
        <TruckIcon className="size-4 text-muted-foreground" aria-hidden="true" />آخرین حواله‌ها
        <Button variant="link" size="xs" className="ms-auto" onClick={onShowAll}>همه</Button>
      </h2>
      {recent.length === 0 ? <p className="text-[13px] text-muted-foreground">حواله‌ای نیست.</p> : (
        <ul className="grid gap-2.5">
          {recent.slice(0, 5).map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-[12px]">
              <div className="min-w-0 flex-1 leading-tight">
                <div dir="ltr" className="text-end font-mono text-[12px] font-semibold">{d.dispatchCode}</div>
                <div className="truncate text-muted-foreground">{d.customerName ?? d.warehouseName ?? "—"}</div>
              </div>
              <Badge variant={statusTone(d.status)}>{DISPATCH_FA[d.status] ?? d.status}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------- دکمه‌های وضعیت حواله و جدول همه‌ی حواله‌ها ----------

/** دکمه‌های وضعیت بعدی یک حواله. بارگیری (موجودی کم می‌شود) و لغو تأیید می‌خواهند. */
export function DispatchActions({
  d, pending, onAdvance,
}: { d: Disp; pending: string | null; onAdvance: (id: string, to: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 md:flex-nowrap">
      {(DISPATCH_NEXT[d.status] ?? []).map((s) => {
        const busy = pending === d.id + s;
        if (s === "loaded")
          return (
            <ConfirmButton key={s} variant="default" pending={busy} title={`بارگیری حواله‌ی ${d.dispatchCode}`}
              confirmLabel="بله، بارگیری شد" onConfirm={() => onAdvance(d.id, s)}
              description={`${num(d.items)} قلم از موجودی${d.warehouseName ? ` ${d.warehouseName}` : ""} کم می‌شود. این کار برنمی‌گردد.`}>
              <TruckIcon />ثبت بارگیری
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
  rows, pending, onAdvance, label, testId,
}: {
  rows: Disp[]; pending: string | null; onAdvance: (id: string, to: string) => void;
  label: string; testId?: string;
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
              <span className="inline-flex items-center gap-1">{d.customerName ? <><UserIcon className="size-3 text-muted-foreground" aria-hidden="true" />{d.customerName}</> : <span className="text-muted-foreground">—</span>}</span>
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
          cell: (d) => <DispatchActions d={d} pending={pending} onAdvance={onAdvance} />,
        },
      ]} />
  );
}
