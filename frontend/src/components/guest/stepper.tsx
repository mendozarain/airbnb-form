import { cn } from "@/lib/utils";

const steps = ["Your email", "Guests", "Confirm"];

/** Signal progress segments that fill in sequence. */
export function Stepper({ step, onJump }: { step: number; onJump: (index: number) => void }) {
  return (
    <nav aria-label="Registration progress" className="my-5">
      <p className="mb-3 text-label text-ink-muted">
        Step {step + 1} of {steps.length} · <span className="text-ink">{steps[step]}</span>
      </p>
      <ol className="flex gap-2">
        {steps.map((label, index) => {
          const done = index < step;
          const active = index === step;
          return (
            <li key={label} className="flex-1">
              <button
                type="button"
                disabled={!done}
                onClick={() => onJump(index)}
                aria-current={active ? "step" : undefined}
                aria-label={`${label}${done ? " (completed, tap to edit)" : ""}`}
                className="block h-6 w-full rounded-full disabled:cursor-default"
              >
                <span className="block h-1.5 overflow-hidden rounded-full bg-hairline">
                  <span
                    key={`${index}-${index <= step}`}
                    className={cn(
                      "sg-fill block h-full w-full rounded-full",
                      done ? "bg-green" : active ? "bg-primary" : "scale-x-0"
                    )}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
