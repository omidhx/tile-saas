"use client";
import { useState } from "react";

/**
 * دکمه‌ی حذف با تأییدِ درجا — نه window.confirm، همان قاعده‌ی بقیه‌ی سایت:
 * هیچ دیالوگِ نیتیوِ مرورگر، همه‌چیز در همان کارت اتفاق می‌افتد.
 */
export default function DeleteButton({ pending, onConfirm }: { pending: boolean; onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming)
    return (
      <span className="row row--start" style={{ gap: "var(--sp-2)" }}>
        <span className="subtle">مطمئنی؟</span>
        <button className="danger" disabled={pending} aria-busy={pending} onClick={onConfirm}>
          {pending && <span className="spinner" aria-hidden="true" />}بله، حذف کن
        </button>
        <button className="ghost" onClick={() => setConfirming(false)}>انصراف</button>
      </span>
    );
  return <button className="danger" onClick={() => setConfirming(true)}>حذف</button>;
}
