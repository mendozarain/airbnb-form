import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

const discs = {
  neutral: "bg-surface-raised text-ink",
  orange: "bg-orange text-on-accent",
  purple: "bg-purple text-on-accent",
  green: "bg-green text-on-accent",
  yellow: "bg-yellow text-on-accent",
  mint: "bg-mint text-on-accent"
} as const;

/** Sunken rounded row: icon disc, title over metadata, trailing pill or actions. */
export function Row({
  icon: Icon,
  iconTone = "neutral",
  title,
  meta,
  trailing,
  to,
  index = 0,
  className
}: {
  icon?: LucideIcon;
  iconTone?: keyof typeof discs;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  to?: string;
  index?: number;
  className?: string;
}) {
  const content = (
    <>
      {Icon && (
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", discs[iconTone])}>
          <Icon className="size-[22px]" strokeWidth={1.75} aria-hidden="true" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-title text-ink">{title}</p>
        {meta && <p className="mt-0.5 text-sm text-ink-muted">{meta}</p>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
    </>
  );
  const classes = cn(
    "sg-row sg-enter flex items-center gap-4 rounded-lg bg-surface-sunken px-4 py-4 text-ink sm:px-5",
    to && "sg-lift hover:bg-hairline",
    className
  );
  const style = { "--i": Math.min(index, 8) } as React.CSSProperties;
  return to ? (
    <Link to={to} className={classes} style={style}>
      {content}
    </Link>
  ) : (
    <div className={classes} style={style}>
      {content}
    </div>
  );
}
