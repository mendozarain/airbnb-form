import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-surface-sunken text-ink",
        pending: "bg-yellow text-on-accent",
        attention: "bg-orange text-on-accent",
        ready: "bg-lime text-on-accent",
        done: "bg-green text-on-accent",
        sent: "bg-mint text-on-accent",
        ai: "bg-purple text-on-accent",
        danger: "bg-surface-sunken text-danger"
      }
    },
    defaultVariants: { tone: "neutral" }
  }
);

type Props = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants> & { dot?: boolean; live?: boolean; pop?: boolean };

/** Status pill: colour says the state, the word always says it too. */
export function Badge({ className, tone, dot, live, pop, children, ...props }: Props) {
  return (
    <span className={cn(badgeVariants({ tone }), pop && "sg-pop", className)} {...props}>
      {(dot || live) && (
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full bg-current",
            live && "animate-[sg-breathe_1.8s_ease-in-out_infinite]"
          )}
        />
      )}
      {children}
    </span>
  );
}
