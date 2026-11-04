/**
 * امکاناتِ اختیاریِ هر کارخانه (فاز ۲). مدیرِ هر کارخانه روشن/خاموششان می‌کند.
 *
 * خاموش یعنی: از منو و API رفته و موتورِ قیمت نادیده‌اش می‌گیرد، ولی داده‌اش می‌ماند
 * و با روشن‌کردنِ دوباره برمی‌گردد. قیمتِ سفارش‌های تأییدشده snapshot است و عوض نمی‌شود.
 *
 * این فایل در کلاینت هم import می‌شود، پس به دیتابیس وابسته نیست (نوشتن: db/features.ts).
 */
export const FEATURE_DEFAULTS = {
  pricing: true,
  price_import: false,
  volume_discount: false,
  agent_price: false,
  price_lists: false,
  auto_approve: false,
  substitutes: false,
};

export type FeatureKey = keyof typeof FEATURE_DEFAULTS;
export type Features = Record<FeatureKey, boolean>;

export const FEATURE_KEYS = Object.keys(FEATURE_DEFAULTS) as FeatureKey[];

/** این‌ها بدونِ قیمت معنا ندارند: وقتی کلیدِ اصلیِ قیمت خاموش است، خاموش حساب می‌شوند. */
const NEEDS_PRICING: FeatureKey[] = ["price_import", "volume_discount", "agent_price", "price_lists", "auto_approve"];

export function normalizeFeatures(raw: unknown): Features {
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = { ...FEATURE_DEFAULTS };
  for (const k of FEATURE_KEYS) if (typeof stored[k] === "boolean") out[k] = stored[k];
  if (!out.pricing) for (const k of NEEDS_PRICING) out[k] = false;
  return out;
}

export const FEATURE_INFO: { key: FeatureKey; label: string; hint: string; needsPricing?: boolean }[] = [
  { key: "pricing", label: "قیمت هر محصول", hint: "نماینده قیمت را موقع رزرو می‌بیند. خاموش شود، همه‌ی امکاناتِ قیمت خاموش می‌شوند." },
  { key: "price_import", label: "ورود قیمت از اکسل", hint: "به‌روزرسانیِ دسته‌جمعیِ قیمت‌ها با فایل.", needsPricing: true },
  { key: "volume_discount", label: "پله‌ی تخفیف حجمی", hint: "تخفیف بر اساسِ تعدادِ کارتن.", needsPricing: true },
  { key: "agent_price", label: "قیمت اختصاصی نماینده", hint: "قیمتِ جدا برای یک نماینده روی یک کالا.", needsPricing: true },
  { key: "price_lists", label: "چند لیست قیمت", hint: "هر نماینده لیستِ خودش را می‌گیرد. خاموش باشد، همه از لیستِ اصلی قیمت می‌گیرند.", needsPricing: true },
  { key: "auto_approve", label: "تأیید خودکار", hint: "رزروِ زیرِ سقفِ مبلغ بدونِ تأییدِ کارمند قبول می‌شود. سفارشِ بدونِ قیمت همیشه دستی می‌ماند.", needsPricing: true },
  { key: "substitutes", label: "کالای جایگزین", hint: "وقتی کالایی ناموجود است، به نماینده کالای مشابه پیشنهاد می‌شود." },
];
