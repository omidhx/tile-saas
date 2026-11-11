import * as React from "react";
import { Label } from "@/components/ui/label";

/**
 * برچسب + کنترل + پیام خطا. id و aria-invalid و aria-describedby را خودش به کنترل می‌دهد تا
 * صفحه‌خوان پیام خطا را همراه فیلد بخواند و هیچ فرمی این سیم‌کشی را فراموش نکند.
 */
export function Field({
  id, label, error, hint, children,
}: {
  id: string;
  label: React.ReactNode;
  error?: string;
  hint?: string;
  children: React.ReactElement<React.InputHTMLAttributes<HTMLElement>>;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {React.cloneElement(children, { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** select بومی با ظاهر Input. فهرست‌های بلند (کالا، نمایندگی) روی موبایل با picker خود سیستم راحت‌ترند. */
export function NativeSelect({ className = "", ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={`h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 disabled:opacity-50 dark:bg-input/30 pointer-coarse:min-h-11 ${className}`}
      {...props}
    />
  );
}
