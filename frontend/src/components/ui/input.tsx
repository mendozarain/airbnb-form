import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-13 w-full rounded-sm border border-line-strong bg-surface-raised px-4 text-base text-ink outline-none placeholder:text-ink-muted focus:outline-2 focus:outline-offset-1 focus:outline-primary aria-invalid:border-danger disabled:bg-surface-sunken",
        className
      )}
      {...props}
    />
  );
}
