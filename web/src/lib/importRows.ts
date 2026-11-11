/**
 * خواندنِ ردیف‌های اکسلِ موجودی (فاز ۵). مرورگر فقط `sheet_to_json` را می‌فرستد و
 * همه‌ی تفسیر این‌جا روی سرور است، تا یک پارسر باشد نه دو تا.
 *
 * قاعده‌ی اصلی: هر چیزی که مطمئن نیستیم خطاست، نه صفر. سلولِ خالی، «۱۲ کارتن»،
 * «1,5» و عددِ اعشاری همه رد می‌شوند. در snapshot عددِ غلط یعنی موجودیِ غلط.
 */

import { isSafeImageUrl } from "./url";

export type ImportRow = {
  row: number;
  sku: string | null; warehouseCode: string | null;
  batchNumber: string | null; shadeCode: string | null; caliberCode: string | null;
  onHand: number | null;
  imageUrl: string | null;
  name: string | null; color: string | null; glaze: string | null; punch: string | null; body: string | null;
};
export type RowError = { row: number | null; reason: string; detail?: string };

// ي و ك عربی، نیم‌فاصله، فاصله و _ در هدرِ اکسل‌های ایرانی زیاد است
const normHeader = (k: string) =>
  k.trim().toLowerCase().replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[\s‌_]/g, "");

const ALIASES: Record<Exclude<keyof ImportRow, "row">, string[]> = {
  sku: ["sku", "کد", "code"],
  warehouseCode: ["warehouse", "warehousecode", "انبار", "wh", "codewh"],
  batchNumber: ["batch", "batchnumber", "بچ", "بچنامبر"],
  shadeCode: ["shade", "shadecode", "شید"],
  caliberCode: ["caliber", "calibercode", "کالیبر"],
  // «قابل سفارش» عمداً نیست: موجودیِ قابل‌فروش است، نه on_hand؛ ورودش موجودی را کم نشان می‌داد
  onHand: ["onhand", "موجودی", "count", "qty"],
  imageUrl: ["image", "imageurl", "عکس", "تصویر", "img"],
  name: ["name", "نام", "محصول", "title"],
  color: ["color", "رنگ"], glaze: ["glaze", "لعاب"], punch: ["punch", "پانچ"], body: ["body", "بدنه"],
};
const FIELD_OF = new Map<string, keyof typeof ALIASES>();
for (const [f, names] of Object.entries(ALIASES)) for (const n of names) FIELD_OF.set(normHeader(n), f as keyof typeof ALIASES);

export const MAX_IMPORT_ROWS = 5000; // spec بخش ۸
export const MAX_QTY = 2_147_483_647; // سقفِ INT در Postgres؛ بزرگ‌ترش 22003 می‌داد

const DIGITS = /[۰-۹٠-٩]/g;
const toAscii = (s: string) => s.replace(DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10));

/** عددِ کارتن. ۱۲۰، "۱۲۰"، "1,200" و "۱٬۲۰۰" قبول؛ خالی، منفی، اعشار و "1,5" خطا. */
export function parseQty(v: unknown): { ok: true; value: number } | { ok: false; reason: string } {
  if (v == null || (typeof v === "string" && v.trim() === "")) return { ok: false, reason: "missing_quantity" };
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const s = toAscii(v.trim());
    // جداکننده‌ی هزارگان فقط در گروه‌های سه‌تایی، وگرنه "1,5" اروپایی ۱۵ می‌شد
    if (!/^\d+$/.test(s) && !/^\d{1,3}([,٬]\d{3})+$/.test(s)) return { ok: false, reason: "bad_quantity" };
    n = Number(s.replace(/[,٬]/g, ""));
  } else return { ok: false, reason: "bad_quantity" };
  if (!Number.isInteger(n) || n < 0 || n > MAX_QTY) return { ok: false, reason: "bad_quantity" };
  return { ok: true, value: n };
}

/** اولین شیتِ فایل، همان‌طور که مرورگر می‌فرستد. هیچ تفسیری این‌جا نیست. */
export function sheetRows(XLSX: typeof import("xlsx"), data: ArrayBuffer | Uint8Array): Record<string, unknown>[] {
  // cellDates: سلولِ تاریخ Date می‌شود، نه شماره‌ی روزِ اکسل (۴۶۰۳۷) که عددِ کارتن به نظر می‌رسید
  const wb = XLSX.read(data, { cellDates: true });
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]])
    // __rowNum__ ناشمردنی است و در JSON نمی‌رود؛ شماره‌ی ردیفِ اکسل برای پیامِ خطا
    .map((o) => ({ ...o, __row: (o as { __rowNum__?: number }).__rowNum__! + 1 }));
}

/**
 * دو ستون که به یک فیلد می‌خورند (مثلاً «کد» و «sku»، یا «موجودی» و «qty») خطای کلِ فایل است.
 * وگرنه ستونِ اول برنده می‌شد و جایی که خالی بود، ستونِ دوم بی‌صدا خوانده می‌شد.
 */
export function columnErrors(rows: Record<string, unknown>[]): RowError[] {
  const byField = new Map<string, Set<string>>();
  for (const raw of rows) for (const k of Object.keys(raw)) {
    const f = FIELD_OF.get(normHeader(k));
    if (f) byField.set(f, (byField.get(f) ?? new Set()).add(k.trim()));
  }
  return [...byField.values()].filter((h) => h.size > 1)
    .map((h) => ({ row: null, reason: "duplicate_column", detail: [...h].join("، ") }));
}

const text = (v: unknown) => (v == null || String(v).trim() === "" ? null : String(v).trim());

/** یک ردیفِ خامِ sheet_to_json. `__row` شماره‌ی ردیفِ اکسل است که مرورگر می‌گذارد. */
export function normalizeRow(raw: Record<string, unknown>, index: number): { row: ImportRow; errors: RowError[] } {
  const rowNo = Number.isInteger(raw.__row) ? (raw.__row as number) : index + 1;
  const got: Partial<Record<keyof typeof ALIASES, unknown>> = {};
  for (const [k, v] of Object.entries(raw)) {
    const f = FIELD_OF.get(normHeader(k));
    if (f && got[f] === undefined) got[f] = v;
  }
  const errors: RowError[] = [];
  const qty = parseQty(got.onHand);
  if (!qty.ok) errors.push({ row: rowNo, reason: qty.reason, detail: got.onHand == null ? undefined : String(got.onHand) });
  const row: ImportRow = {
    row: rowNo,
    sku: text(got.sku), warehouseCode: text(got.warehouseCode),
    batchNumber: text(got.batchNumber), shadeCode: text(got.shadeCode), caliberCode: text(got.caliberCode),
    onHand: qty.ok ? qty.value : null,
    imageUrl: text(got.imageUrl), name: text(got.name),
    color: text(got.color), glaze: text(got.glaze), punch: text(got.punch), body: text(got.body),
  };
  if (!row.sku) errors.push({ row: rowNo, reason: "missing_sku" });
  if (!row.warehouseCode) errors.push({ row: rowNo, reason: "missing_warehouse" });
  if (row.imageUrl && !isSafeImageUrl(row.imageUrl)) errors.push({ row: rowNo, reason: "bad_image_url", detail: row.imageUrl });
  return { row, errors };
}
