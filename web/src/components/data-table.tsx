import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** ستون عملیات: روی موبایل برچسب نمی‌گیرد و تمام‌عرض می‌شود. */
  actions?: boolean;
  className?: string;
};

/**
 * جدول فشرده برای فهرست‌های کاری. زیر md هر ردیف یک کارت می‌شود و هر خانه برچسب ستونش را
 * می‌گیرد (data-label)، چون جدول ۶ستونه در ۳۷۵px یا اسکرول افقی می‌خواهد یا خوانده نمی‌شود.
 * همان DOM در هر دو حالت؛ فقط CSS عوض می‌شود.
 * ponytail: مرتب‌سازی، فیلتر ستونی، اندازه‌ی صفحه و خروجی Excel نیست؛ اولین صفحه‌ای که لازمشان دارد (فاز ۷) اضافه کند.
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
  return (
    <table aria-label={label} data-testid={testId} className="w-full text-sm max-md:block">
      <thead className="max-md:sr-only">
        <tr className="border-b text-muted-foreground">
          {columns.map((c) => (
            <th key={c.key} scope="col" className={cn("h-9 px-3 text-start text-xs font-medium whitespace-nowrap", c.className)}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="max-md:grid max-md:gap-2">
        {rows.map((row) => (
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
