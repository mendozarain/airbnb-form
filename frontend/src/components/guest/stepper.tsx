import { Check, ClipboardCheck, Mail, Users, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const steps: Array<{ label: string; icon: LucideIcon }> = [
  { label: "Your email", icon: Mail },
  { label: "Guests", icon: Users },
  { label: "Confirm", icon: ClipboardCheck }
];

export function Stepper({ step, onJump }: { step: number; onJump: (index: number) => void }) {
  return (
    <nav aria-label="Registration progress" className="my-6">
      <p className="text-label mb-4 text-center text-ink-muted">
        Step {step + 1} of {steps.length}
      </p>
      <ol className="flex items-start">
        {steps.map(({ label, icon: Icon }, index) => {
          const done = index < step;
          const active = index === step;
          return (
            <li key={label} className={cn("flex flex-1 flex-col items-center", index > 0 && "relative")}>
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute right-1/2 top-6 h-0.5 w-full -translate-y-1/2",
                    index <= step ? "bg-primary" : "bg-hairline"
                  )}
                />
              )}
              <button
                type="button"
                disabled={!done}
                onClick={() => onJump(index)}
                aria-current={active ? "step" : undefined}
                aria-label={`${label}${done ? " (completed, tap to edit)" : ""}`}
                className={cn(
                  "relative z-10 flex size-12 items-center justify-center rounded-full transition",
                  active && "bg-primary text-on-primary ring-4 ring-primary-soft",
                  done && "bg-success text-white",
                  !active &&
                    !done &&
                    "bg-surface-raised text-ink-muted shadow-[inset_0_0_0_2px_var(--color-line-strong)]"
                )}
              >
                {done ? (
                  <Check className="size-5" strokeWidth={2} />
                ) : (
                  <Icon className="size-5" strokeWidth={1.5} />
                )}
              </button>
              <span className={cn("mt-2 text-xs font-semibold", active ? "text-primary" : "text-ink-muted")}>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
