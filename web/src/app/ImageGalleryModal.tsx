"use client";
import { useRef } from "react";
import type { ReactNode } from "react";
import Image from "next/image";
import { useEscapeClose } from "@/lib/useEscapeClose";
import { hideOnError } from "@/lib/img";

/**
 * پوسته‌ی مشترکِ مودالِ جزئیاتِ محصول (reserve، CatalogView): بک‌دراپ + هدر با
 * دکمه‌ی بستن + عکسِ اصلی + نوارِ thumbnailِ گالری. ردیف‌های ویژگی/توضیحات که
 * بینِ دو صفحه فرق می‌کنند، `children` می‌مانند — یکی‌کردنشان یعنی این کامپوننت
 * باید شکلِ خاصِ یکی از دو caller را بگیرد.
 *
 * چون فقط وقتی این کامپوننت mount است که مودال باز است، خودش وضعیتِ «باز»ِ
 * useEscapeClose را حمل می‌کند — caller دیگر نیازی به closeBtnRef/useEscapeClose
 * جدا ندارد.
 */
export function ImageGalleryModal({
  title, gallery, activeIndex, onSelectIndex, onClose, children,
}: {
  title: string;
  gallery: string[];
  activeIndex: number;
  onSelectIndex: (i: number) => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  useEscapeClose(true, onClose, closeBtnRef);
  const main = gallery[activeIndex] ?? gallery[0];

  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <strong>{title}</strong>
          <button ref={closeBtnRef} className="ghost" onClick={onClose} aria-label="بستن">✕</button>
        </div>
        {main && (
          <Image onError={hideOnError} src={main} alt={title} className="modal-img"
            width={800} height={600} style={{ width: "100%", height: "auto" }} />
        )}
        {gallery.length > 1 && (
          <div className="gallery" style={{ marginTop: "var(--sp-2)" }}>
            {gallery.map((u, i) => (
              <button key={i} className={`gallery-item ${i === activeIndex ? "gallery-item--primary" : ""}`}
                      onClick={() => onSelectIndex(i)} aria-label={`عکس ${i + 1}`}>
                <Image onError={hideOnError} src={u} alt="" loading="lazy" width={72} height={72} />
              </button>
            ))}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
