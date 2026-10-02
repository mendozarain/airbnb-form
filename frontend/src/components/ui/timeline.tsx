import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const dots = {
  neutral: "bg-surface-sunken text-ink",
  yellow: "bg-yellow text-on-accent",
  mint: "bg-mint text-on-accent",
  purple: "bg-purple text-on-accent",
  green: "bg-green text-on-accent",
  orange: "bg-orange text-on-accent"
} as const;

export type TimelineItem = {
  date: string;
  icon: LucideIcon;
  title: string;
  meta?: string;
  tone?: keyof typeof dots;
  live?: boolean;
};

/** Newest first. Mono date, coloured disc joined by a line, title and one line of metadata. */
export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="m-0 list-none p-0">
      {items.map((item, index) => {
        const Icon = item.icon;
        const last = index === items.length - 1;
        return (
          <li
            key={`${item.title}-${index}`}
            className={cn(
              "sg-enter relative grid grid-cols-[64px_44px_1fr] gap-x-3 sm:grid-cols-[72px_44px_1fr] sm:gap-x-4",
              !last && "pb-6"
            )}
            style={{ "--i": index } as React.CSSProperties}
          >
            {!last && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 top-11 left-[calc(64px+12px+21px)] w-0.5 bg-primary sm:left-[calc(72px+16px+21px)]"
              />
            )}
            <time className="pt-1 text-mono text-ink-muted">{item.date}</time>
            <span
              className={cn(
                "grid size-11 place-items-center rounded-full",
                dots[item.tone ?? "neutral"],
                item.live && "sg-dot-live"
              )}
            >
              <Icon className="size-[22px]" strokeWidth={1.75} aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-2">
              <h4 className="text-title text-ink">{item.title}</h4>
              {item.meta && <p className="mt-1 text-[15px] leading-5 text-ink-muted">{item.meta}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
