import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-32 w-full rounded-sm border border-line-strong bg-surface-raised px-4 py-3 text-base text-ink outline-none placeholder:text-ink-muted focus:outline-2 focus:outline-offset-1 focus:outline-primary aria-invalid:border-danger",
        className
      )}
      {...props}
    />
  );
}
