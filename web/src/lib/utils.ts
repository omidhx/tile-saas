import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** ادغام کلاس‌های Tailwind؛ کلاس بعدی روی قبلی می‌نشیند. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
