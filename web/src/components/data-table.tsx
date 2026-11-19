"use client";
import { useMemo, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, ArrowUpDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** ستون عملیات: روی موبایل برچسب نمی‌گیرد و تمام‌عرض می‌شود. */
  actions?: boolean;
  className?: string;
  /** با این، سرستون دکمه‌ی مرتب‌سازی می‌شود (کلیک: صعودی، نزولی). */
  sortValue?: (row: T) => string | number | null;
};

/**
 * جدول فشرده برای فهرست‌های کاری. زیر md هر ردیف یک کارت می‌شود و هر خانه برچسب ستونش را
 * می‌گیرد (data-label)، چون جدول ۶ستونه در ۳۷۵px یا اسکرول افقی می‌خواهد یا خوانده نمی‌شود.
 * همان DOM در هر دو حالت؛ فقط CSS عوض می‌شود.
 * مرتب‌سازی با سرستون (فاز ۷). خروجی Excel در `lib/excel.ts`.
 * ponytail: فیلتر ستونی و اندازه‌ی صفحه نیست؛ جستجوی بالای هر صفحه سمت سرور است و فهرست‌ها سقف دارند.
 */
export function DataTable<T>({
  columns, rows, rowKey, rowClassName, label, testId,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  /** نام جدول برای صفحه‌خوان */
  label: string;
  testId?: string;
}) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const v = col.sortValue;
    return [...rows].sort((a, b) => {
      const x = v(a), y = v(b);
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "fa")) * sort!.dir;
    });
  }, [rows, columns, sort]);
  return (
    <table aria-label={label} data-testid={testId} className="w-full text-sm max-md:block">
      <thead className="max-md:sr-only">
        <tr className="border-b text-muted-foreground">
          {columns.map((c) => (
            <th key={c.key} scope="col" className={cn("h-9 px-3 text-start text-xs font-medium whitespace-nowrap", c.className)}
              aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
              {/* زیر md سرستون پنهان است و ردیف کارت می‌شود؛ دکمه‌ی پنهانِ قابل‌فوکوس نمی‌ماند. */}
              {c.sortValue && <span className="md:hidden">{c.header}</span>}
              {c.sortValue ? (
                <button type="button" className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring outline-none max-md:hidden"
                  onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}>
                  {c.header}
                  {sort?.key === c.key ? (sort.dir === 1 ? <ArrowUpIcon className="size-3" aria-hidden="true" /> : <ArrowDownIcon className="size-3" aria-hidden="true" />)
                    : <ArrowUpDownIcon className="size-3 opacity-40" aria-hidden="true" />}
                </button>
              ) : c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="max-md:grid max-md:gap-2">
        {sorted.map((row) => (
          <tr
            key={rowKey(row)}
            data-row
            className={cn(
              "border-b transition-colors last:border-0 hover:bg-muted/50",
              "max-md:grid max-md:gap-1.5 max-md:rounded-lg max-md:border max-md:bg-card max-md:p-3 max-md:last:border",
              rowClassName?.(row),
            )}
          >
            {columns.map((c) => (
              <td
                key={c.key}
                data-label={c.actions ? undefined : c.header}
                className={cn(
                  "px-3 py-2.5 align-middle",
                  "max-md:flex max-md:gap-3 max-md:p-0",
                  c.actions
                    ? "max-md:pt-1.5 max-md:[&>*]:flex-1 max-md:[&>*>*]:flex-1"
                    : "max-md:before:w-24 max-md:before:shrink-0 max-md:before:text-xs max-md:before:text-muted-foreground max-md:before:content-[attr(data-label)]",
                  c.className,
                )}
              >
                {c.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
