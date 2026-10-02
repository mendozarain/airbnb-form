import type { LucideIcon } from "lucide-react";
import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  icon: LucideIcon;
  label: string;
  hint?: string;
  error?: string;
};

/** Signal text field: boxed input with a leading outline icon. */
export const IconField = forwardRef<HTMLInputElement, Props>(function IconField(
  { icon: Icon, label, hint, error, className, id, ...props },
  ref
) {
  const auto = useId();
  const inputId = id ?? auto;
  const helpId = `${inputId}-help`;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="text-sm font-medium text-ink-muted">
        {label}
      </label>
      <div
        className={cn(
          "mt-2 flex h-13 items-center gap-3 rounded-sm border bg-surface-raised px-4 text-ink-muted focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-primary",
          error ? "border-danger text-danger" : "border-line-strong"
        )}
      >
        <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <input
          ref={ref}
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || hint ? helpId : undefined}
          className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
          {...props}
        />
      </div>
      {(error || hint) && (
        <p id={helpId} className={cn("mt-1 text-sm", error ? "text-danger" : "text-ink-muted")}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
});
