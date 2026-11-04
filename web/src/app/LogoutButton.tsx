"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** دکمه‌ی خروج — مشترک بین صفحه‌های نماینده و staff. */
export default function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      className="ghost"
      style={{ padding: ".3rem .7rem", fontSize: ".85rem" }}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/login");
      }}
    >
      {pending ? "…" : "خروج"}
    </button>
  );
}
