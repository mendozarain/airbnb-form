import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const badges = {
  neutral: null,
  pending: "bg-yellow",
  attention: "bg-orange",
  done: "bg-green",
  ai: "bg-purple"
} as const;

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  size = "md",
  tone = "neutral",
  className
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  size?: "sm" | "md";
  tone?: keyof typeof badges;
  className?: string;
}) {
  const small = size === "sm";
  const badge = badges[tone];
  return (
    <div
      role="status"
      className={cn("flex flex-col items-center text-center", small ? "gap-2 p-4" : "px-6 py-10", className)}
    >
      <div className={cn("relative", small ? "mb-1 size-14" : "mb-5 size-24")}>
        <span className="absolute inset-0 rounded-full bg-surface-sunken" />
        <span className="absolute inset-0 grid place-items-center text-ink">
          <Icon
            className={cn("sg-float", small ? "size-6" : "size-9")}
            strokeWidth={1.75}
            aria-hidden="true"
          />
        </span>
        {badge && (
          <span
            className={cn("sg-pop absolute right-0.5 top-1.5 size-6 rounded-full", badge)}
            style={{ animationDelay: ".3s" }}
          />
        )}
      </div>
      <p
        className={cn(
          "text-ink",
          small ? "text-base font-medium" : "text-[22px] leading-7 font-semibold tracking-tight"
        )}
      >
        {title}
      </p>
      {description && (
        <p className={cn("max-w-xs text-ink-muted", small ? "text-sm" : "mt-2 text-base")}>{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
