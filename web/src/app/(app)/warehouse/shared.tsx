"use client";
import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/field";
import { getJson } from "@/lib/api";

/** شکل پاسخ `/api/pallets` و `/api/stock` (فاز ۷). */
export type PalletLine = {
  lotId: string; variantId: string; productName: string; productCode: string; sku: string; grade: string | null;
  batchNumber: string | null; shadeCode: string | null; caliberCode: string | null; qty: number; sqcmPerBox: number | null;
};
export type Pallet = {
  id: string; palletNo: number; warehouseId: string; warehouseName: string; columnCode: string | null; positionNo: number | null;
  note: string | null; createdAt: string; status: "in_stock" | "exited"; totalBoxes: number; lines: PalletLine[];
};
export type Warehouse = { id: string; name: string; code: string };

export const num = (v: number) => v.toLocaleString("fa-IR");
export const sqm = (sqcm: number) => (sqcm / 10000).toLocaleString("fa-IR", { maximumFractionDigits: 2 });

/** «۶۰×۶۰ درجه ۲» */
export const lineName = (l: Pick<PalletLine, "productName" | "grade">) => l.productName + (l.grade ? ` درجه ${l.grade}` : "");
/** «بچ B1 · شید S · کالیبر C»؛ خالی اگر هیچ‌کدام نیست. */
export const lotLabel = (l: Pick<PalletLine, "batchNumber" | "shadeCode" | "caliberCode">) =>
  [l.batchNumber && `بچ ${l.batchNumber}`, l.shadeCode && `شید ${l.shadeCode}`, l.caliberCode && `کالیبر ${l.caliberCode}`].filter(Boolean).join(" · ");
export const location = (p: Pick<Pallet, "columnCode" | "positionNo">) =>
  p.columnCode ? `ستون ${p.columnCode}${p.positionNo ? ` · شماره ${num(p.positionNo)}` : ""}` : null;
export const palletSqcm = (p: Pallet) => p.lines.reduce((s, l) => s + (l.sqcmPerBox ?? 0) * l.qty, 0);

/** پیام فارسی برای کد خطای `/api/pallets`. */
export function palletError(code: string | undefined, status: number): string {
  const m: Record<string, string> = {
    stale: "از وقتی این پنجره باز شد، تعداد این پالت عوض شده (خروج یا بارگیری). پنجره را ببندید و دوباره باز کنید.",
    no_quantity: "دست‌کم یک ردیف را با تعداد بیشتر از صفر پر کنید.",
    below_committed: "این کارتن‌ها رزرو، تخصیص یا بلوکه دارند؛ موجودی آزاد این lot کافی نیست.",
    exceeds_pallet: "تعداد بیشتر از کارتن‌های روی این پالت است.",
    reason_required: "دلیل را انتخاب کنید (برای «سایر» توضیح هم لازم است).",
    unknown_line: "این ردیف دیگر روی پالت نیست؛ فهرست را تازه کنید.",
    empty_pallet: "این پالت خالی است.",
    not_found: "پالت پیدا نشد.",
    warehouse_not_found: "انبار پیدا نشد.",
    unknown_variant: "کالا پیدا نشد.",
    missing_shade_caliber: "شید و کالیبر در این کارخانه اجباری است.",
    ambiguous_lot: "دو Lot با همین کالا، بچ، شید و کالیبر هست؛ اول از کاتالوگ یکی‌شان کنید.",
    duplicate_line: "یک کالا با همان بچ، شید و کالیبر دو بار روی یک پالت آمده است.",
    too_many_pallets: "در هر ثبت حداکثر ۵۰۰ پالت.",
    invalid: "مقدارها را بررسی کنید.",
  };
  if (code && m[code]) return m[code];
  if (status === 0) return "ارتباط با سرور برقرار نشد.";
  if (status === 403) return "اجازه‌ی این کار را نداری.";
  return `انجام نشد (خطای ${status}).`;
}

export function useWarehouses(tenantId: string) {
  const [list, setList] = useState<Warehouse[]>([]);
  useEffect(() => {
    void getJson<{ warehouses: Warehouse[] }>(`/api/warehouses?tenantId=${tenantId}`).then((r) => { if (r.ok) setList(r.data.warehouses); });
  }, [tenantId]);
  return list;
}

export function WarehouseFilter({ warehouses, value, onChange }: { warehouses: Warehouse[]; value: string; onChange: (v: string) => void }) {
  return (
    <NativeSelect aria-label="انبار" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 sm:w-48">
      <option value="">همه‌ی انبارها</option>
      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </NativeSelect>
  );
}

export function SearchBox({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative min-w-0 flex-1">
      <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 ps-8" />
    </div>
  );
}

/** مقدار با تأخیر: جستجو با هر حرف درخواست نمی‌زند (سقف ۶۰ GET در دقیقه). */
export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
