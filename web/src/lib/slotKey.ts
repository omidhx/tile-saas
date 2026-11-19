/**
 * کلیدِ تطبیقِ «ستون + شماره»ی پالت با جای پالت روی نقشه (فاز ۸). ستونِ پالت همان‌طور که تایپ شده ذخیره
 * می‌شود (ورود کالا، ویرایش، انتقال)، پس تطبیق باید رقم فارسی و عربی، ی/ك عربی، فاصله‌ی دو طرف و حروف
 * کوچک و بزرگ را یکی بداند. همین قاعده در SQL: ایندکسِ `uq_warehouse_cell_slot` و `offMap` در
 * `db/warehouseMap.ts` با `upper(translate(btrim(...)))`.
 */
const FA = "۰۱۲۳۴۵۶۷۸۹", AR = "٠١٢٣٤٥٦٧٨٩";
export const columnKey = (col: string) =>
  col.trim()
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)))
    .replace(/ي/g, "ی").replace(/ك/g, "ک")
    .toUpperCase();
export const slotKey = (col: string, pos: number) => `${columnKey(col)}#${pos}`;
