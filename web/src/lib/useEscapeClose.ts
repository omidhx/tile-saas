"use client";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * الگوی مشترکِ مودال‌ها (reserve، CatalogView، NavMenu): Escape می‌بندد، و اختیاراً
 * فوکوس روی یک المان (مثلاً دکمه‌ی بستن) می‌رود — کاربرِ کیبورد مجبور نیست
 * کورکورانه Tab بزند تا به دیالوگِ تازه‌بازشده برسد.
 *
 * فقط بخشِ Escape+فوکوس مشترک است. منطقِ اضافیِ NavMenu (بستن با کلیکِ بیرون،
 * فوکوس رویِ اولین لینک به‌جای یک ref ثابت) جدا می‌ماند — یکی‌کردنش این‌جا یعنی
 * هوک باید برایِ یک caller استثنایی شکل بگیرد.
 */
export function useEscapeClose(
  active: boolean,
  onClose: () => void,
  focusRef?: RefObject<HTMLElement | null>,
) {
  // ref: هر caller معمولاً onClose را inline می‌سازد (closure تازه هر رندر)؛
  // اگر مستقیم در depsِ افکت بیاید، listener هر رندر (نه فقط هر toggleِ active) دوباره بسته می‌شود.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  useEffect(() => { if (active) focusRef?.current?.focus(); }, [active, focusRef]);
}
