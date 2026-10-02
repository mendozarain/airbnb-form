import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-13 w-full rounded-sm border border-line-strong bg-surface-raised px-3 text-base text-ink outline-none focus:outline-2 focus:outline-offset-1 focus:outline-primary",
        className
      )}
      {...props}
    />
  );
}
