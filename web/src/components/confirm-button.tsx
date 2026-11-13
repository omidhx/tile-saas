"use client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * دکمه‌ی کار برگشت‌ناپذیر (بارگیری که موجودی را کم می‌کند، لغو). یک کلیک اضافه عمدی است:
 * اشتباه در این‌ها با «برگرداندن» درست نمی‌شود. فوکوس اول روی «انصراف» است (رفتار Radix)،
 * پس Enter عجولانه کار را انجام نمی‌دهد.
 */
export function ConfirmButton({
  children, title, description, confirmLabel, onConfirm, pending, destructive, variant = "outline", size = "sm",
}: {
  children: React.ReactNode;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  pending?: boolean;
  destructive?: boolean;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={variant} size={size} pending={pending}
          className={destructive && variant === "ghost" ? "text-destructive hover:text-destructive" : undefined}>{children}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>انصراف</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
