import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatGrid } from "./stat-grid";

/**
 * The one big status card per screen. Yellow frame + cream panel while something is pending;
 * `plain` renders the same structure in a white card for every other state.
 */
export function StatusHero({
  chipIcon: ChipIcon,
  chip,
  title,
  sub,
  stats,
  plain,
  action,
  className
}: {
  chipIcon?: LucideIcon;
  chip: ReactNode;
  title: string;
  sub?: ReactNode;
  stats?: Array<{ label: string; value: string; mono?: boolean }>;
  plain?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("sg-enter rounded-xl p-3 sm:p-4", plain ? "bg-surface-raised" : "bg-yellow", className)}
    >
      <div className="mb-3 flex items-center justify-between gap-3 sm:mb-4">
        <span
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-medium",
            plain ? "bg-surface-sunken text-ink" : "bg-surface-raised text-ink"
          )}
        >
          {ChipIcon && <ChipIcon className="size-5" strokeWidth={1.75} aria-hidden="true" />}
          {chip}
        </span>
        {action}
      </div>
      <div className={cn("rounded-lg p-5 sm:p-6", plain ? "bg-surface-sunken" : "bg-yellow-soft")}>
        <h2 className="text-[26px] leading-8 font-semibold tracking-tight text-ink sm:text-heading-xl">
          {title}
        </h2>
        {sub && (
          <p className={cn("mt-2 text-base", plain ? "text-ink-muted" : "text-ink-on-soft", stats && "mb-5")}>
            {sub}
          </p>
        )}
        {stats && <StatGrid items={stats} soft={!plain} className={sub ? "" : "mt-5"} />}
      </div>
    </section>
  );
}
