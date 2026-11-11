"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Loader2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getJson, loadError } from "@/lib/api";

export type CustomerOption = { id: string; name: string };

/**
 * جست‌وجو و انتخاب مشتری از GET /api/customers (tenant و دسترسی همان‌جا چک می‌شود). شناسه نگه
 * داشته می‌شود، نه فقط نام. منطق همان CustomerPicker قدیمی است.
 */
export function CustomerField({
  tenantId, value, onChange,
}: { tenantId: string; value: CustomerOption | null; onChange: (c: CustomerOption | null) => void }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [active, setActive] = useState(-1);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function search(v: string) {
    setQ(v); setOpen(true); setErr("");
    if (debounce.current) clearTimeout(debounce.current);
    const mine = ++gen.current;
    debounce.current = setTimeout(() => void (async () => {
      setLoading(true);
      const res = await getJson<{ customers: CustomerOption[] }>(
        `/api/customers?tenantId=${tenantId}&q=${encodeURIComponent(v)}`);
      if (mine !== gen.current) return; // جست‌وجوی تازه‌تری جلو زده
      setLoading(false);
      if (res.ok) { setOptions(res.data.customers); setActive(-1); } else setErr(loadError(res.status));
    })(), 300);
  }

  function pick(c: CustomerOption) { onChange(c); setQ(""); setOpen(false); setOptions([]); }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || options.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (active >= 0) pick(options[active]); }
    else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } // دیالوگ بسته نشود، فقط فهرست
  }

  return (
    <div className="relative grid gap-1.5" ref={boxRef}>
      <Label htmlFor={id}>مشتری (اختیاری)</Label>
      {value ? (
        <div className="flex h-8 items-center justify-between rounded-lg border bg-muted/50 px-2.5 text-sm">
          <span className="font-medium">{value.name}</span>
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => onChange(null)} aria-label="حذف مشتری انتخاب‌شده">
            <XIcon />
          </Button>
        </div>
      ) : (
        <>
          <Input id={id} role="combobox" aria-expanded={open} aria-autocomplete="list" aria-controls={`${id}-list`}
            aria-activedescendant={active >= 0 ? `${id}-o${active}` : undefined}
            placeholder="نام مشتری را بنویسید…" value={q} autoComplete="off"
            onChange={(e) => search(e.target.value)} onFocus={() => q && setOpen(true)} onKeyDown={onKeyDown} />
          {open && q && (
            <div id={`${id}-list`} role="listbox" aria-label="مشتری‌ها"
              className="absolute inset-x-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border bg-popover p-1 text-sm shadow-md">
              {loading && <div className="flex items-center gap-2 p-2 text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />در حال جست‌وجو…</div>}
              {!loading && err && <div className="p-2 text-destructive">{err}</div>}
              {!loading && !err && options.length === 0 && <div className="p-2 text-muted-foreground">مشتری‌ای پیدا نشد.</div>}
              {!loading && options.map((c, i) => (
                <div key={c.id} id={`${id}-o${i}`} role="option" aria-selected={i === active}
                  className="cursor-pointer rounded-md px-2 py-1.5 aria-selected:bg-muted"
                  onMouseEnter={() => setActive(i)} onClick={() => pick(c)}>
                  {c.name}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
