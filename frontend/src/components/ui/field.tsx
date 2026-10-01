import type { LucideIcon } from "lucide-react";
import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  icon: LucideIcon;
  label: string;
  hint?: string;
  error?: string;
};

/** Confetti underline-only field with a leading outline icon. */
export const IconField = forwardRef<HTMLInputElement, Props>(function IconField(
  { icon: Icon, label, hint, error, className, id, ...props },
  ref
) {
  const auto = useId();
  const inputId = id ?? auto;
  const helpId = `${inputId}-help`;
  return (
    <div className={className}>
      <label htmlFor={inputId} className="text-sm font-semibold text-ink">
        {label}
      </label>
      <div
        className={cn(
          "group mt-1 flex items-center gap-3 border-b py-3 text-ink-muted focus-within:border-b-2 focus-within:text-primary",
          error ? "border-danger text-danger" : "border-line-strong focus-within:border-primary"
        )}
      >
        <Icon className="size-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
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
