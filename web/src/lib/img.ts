/**
 * عکسِ خراب (URL مرده) به‌جای آیکنِ broken-imageِ مرورگر، کلاً پنهان می‌شود —
 * قابِ خالیِ پس‌زمینه از علامتِ خرابی تمیزتر است. یک‌جا، برای هر ۹ نقطه‌ی <img> سایت.
 */
export const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.display = "none";
};
