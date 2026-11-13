import { CircleAlertIcon, CircleCheckIcon, InboxIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertAction, AlertDescription } from "@/components/ui/alert";

/** هیچ موردی نیست. فقط وقتی نشان داده شود که بارگذاری موفق بوده؛ «نشد» بنر خطاست، نه این. */
export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">
      <InboxIcon className="size-4" aria-hidden="true" />
      {children}
    </div>
  );
}

export function LoadingState({ label = "در حال بارگذاری…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 px-1 py-6 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

const NOTICE = {
  error: { variant: "destructive", Icon: CircleAlertIcon, role: "alert" },
  warning: { variant: "warning", Icon: TriangleAlertIcon, role: "status" },
  success: { variant: "success", Icon: CircleCheckIcon, role: "status" },
} as const;

/** بنر بالای صفحه: خطا role=alert می‌گیرد، بقیه role=status تا صفحه‌خوان کار کاربر را قطع نکند. */
export function Notice({
  tone, children, action,
}: { tone: keyof typeof NOTICE; children: React.ReactNode; action?: React.ReactNode }) {
  const { variant, Icon, role } = NOTICE[tone];
  return (
    <Alert variant={variant} role={role}>
      <Icon aria-hidden="true" />
      <AlertDescription className="text-current">{children}</AlertDescription>
      {action && <AlertAction>{action}</AlertAction>}
    </Alert>
  );
}
