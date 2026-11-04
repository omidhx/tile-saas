"use client";
import { useEffect } from "react";

/**
 * ثبتِ service worker فقط در production — روی dev، فایل‌های استاتیکِ
 * `_next/static/` با هر rebuild عوض می‌شوند و کشِ SW نسخه‌ی کهنه سرو می‌کرد
 * (تله‌ی معروف: «چرا تغییرم دیده نمی‌شود؟»، درحالی‌که خودِ کد درست است).
 */
export default function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // آفلاین‌بودنِ کاتالوگ یک مزیتِ اضافه است، نه چیزی که نبودش باید کاربر را متوقف کند
    });
  }, []);
  return null;
}
