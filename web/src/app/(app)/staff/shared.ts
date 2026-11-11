/** نوع‌ها و برچسب‌های کارتابل؛ شکل پاسخ همان API های قبلی است، چیزی در سرور عوض نشده. */

/** ارقام فارسی، همه‌جا یکسان. */
export const num = (v: number) => v.toLocaleString("fa-IR");
export const numUnit = (v: number) => v.toLocaleString("fa-IR", { maximumFractionDigits: 2 });

export type ResvItem = {
  name: string; code: string; quantityBoxes: number;
  boxesPerPallet: number | null; sqcmPerBox: number | null;
};
export type Resv = {
  id: string; status: string; expiresAt: string; agentName: string;
  assignedStaffName: string | null; assignedStaffPhone: string | null; items: ResvItem[];
};
export type Req = {
  id: string; status: string; agentName: string; approvalMode: "manual" | "auto";
  assignedStaffName: string | null; assignedStaffPhone: string | null;
  items: { name: string; code: string; qty: number }[];
};
export type Disp = {
  id: string; dispatchCode: string; status: string;
  customerName: string | null; destination: string | null; referenceNumber: string | null;
  items: number; warehouseName: string | null;
};
export type Agent = { id: string; legalName: string };
export type Variant = { id: string; name: string; code: string; sku: string };
export type Backorder = {
  id: string; status: string; qty: number; name: string; code: string;
  dispatchCode: string; agentName: string;
};
export type LowStockItem = { variantId: string; name: string; code: string; available: number };
export type DashboardKpis = { todayDispatches: number; todayBoxes: number; lowStock: LowStockItem[] };
export type DispatchExtra = { destination?: string; customerId?: string; referenceNumber?: string };

/** گذارهای مجاز وضعیت حواله؛ سرور همین را اجبار می‌کند، این فقط دکمه‌ها را می‌سازد. */
export const DISPATCH_NEXT: Record<string, string[]> = {
  registered: ["ready_for_loading", "cancelled"],
  ready_for_loading: ["loaded", "cancelled"],
  loaded: ["delivered"],
  delivered: [], cancelled: [],
};
export const DISPATCH_FA: Record<string, string> = {
  registered: "ثبت‌شده", ready_for_loading: "آماده بارگیری", loaded: "بارگیری‌شده",
  delivered: "تحویل‌شده", cancelled: "لغوشده",
};
export const BO_NEXT: Record<string, string[]> = {
  pending_production: ["ready", "cancelled"], ready: ["fulfilled", "cancelled"], fulfilled: [], cancelled: [],
};
export const BO_FA: Record<string, string> = {
  pending_production: "در انتظار تولید", ready: "آماده", fulfilled: "تحویل‌شده", cancelled: "لغوشده",
};

export function statusTone(s: string): "success" | "destructive" | "warning" | "secondary" {
  if (s === "loaded" || s === "delivered" || s === "fulfilled") return "success";
  if (s === "cancelled") return "destructive";
  if (s === "ready_for_loading" || s === "ready" || s === "pending_production") return "warning";
  return "secondary";
}

/** «نام ×تعداد» هر قلم، با معادل پالت و مترمربع برای سنجش سریع سفارش‌های بزرگ. */
export function itemLine(i: ResvItem) {
  const extra = [
    i.boxesPerPallet && `${numUnit(i.quantityBoxes / i.boxesPerPallet)} پالت`,
    i.sqcmPerBox && `${numUnit((i.quantityBoxes * i.sqcmPerBox) / 10000)} مترمربع`,
  ].filter(Boolean).join("، ");
  return { main: `${i.name} ×${num(i.quantityBoxes)}`, extra };
}
