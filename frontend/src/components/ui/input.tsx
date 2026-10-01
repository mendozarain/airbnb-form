import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-11 w-full rounded-md border border-line-strong bg-surface-raised px-3 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-primary focus:ring-2 focus:ring-primary-soft disabled:bg-surface",
        className
      )}
      {...props}
    />
  );
}
