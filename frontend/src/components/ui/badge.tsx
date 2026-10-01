import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", {
  variants: {
    tone: {
      neutral: "bg-surface text-ink-muted shadow-[inset_0_0_0_1px_var(--color-hairline)]",
      info: "bg-primary-soft text-primary",
      success: "bg-success/10 text-success",
      warning: "bg-butter/60 text-ink",
      danger: "bg-danger/10 text-danger"
    }
  },
  defaultVariants: { tone: "neutral" }
});

type Props = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, tone, ...props }: Props) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
