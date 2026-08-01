export type Img = { id: string; url: string };
export type Product = {
  id: string; name: string; code: string;
  imageUrl: string | null; color: string | null; glaze: string | null;
  punch: string | null; body: string | null;
  size: string | null; thickness: string | null; usageArea: string | null; description: string | null;
  images: Img[]; sku: string | null;
  variantId: string | null; hasStock: boolean; basePrice: number | null;
  /** بسته‌بندیِ فیزیکی — پایه‌ی تبدیلِ کارتن⇄پالت⇄مترمربع در صفحه‌ی سفارشِ نماینده. */
  boxesPerPallet: number | null; sqcmPerBox: number | null;
};
export type Sub = {
  id: string; variantId: string; substituteVariantId: string;
  substituteName: string; substituteCode: string; note: string | null;
};
export type Wh = { id: string; name: string; code: string };
export type PriceList = { id: string; name: string; agentCount: number };
export type PriceItem = { priceListId: string; variantId: string; price: string };
export type IncomingItem = {
  id: string; variantId: string;
  warehouseId: string; warehouseName: string;
  quantityBoxes: number; expectedAt: string;
  source: string; status: "planned" | "confirmed" | "arrived" | "cancelled"; note: string | null;
};

export const money = (v: number) => v.toLocaleString("fa-IR");
export const sqm = (cm2: number) => (cm2 / 10000).toLocaleString("fa-IR", { maximumFractionDigits: 2 });
