import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Confetti } from "./confetti";

const circles = {
  neutral: "bg-primary-soft text-primary",
  warning: "bg-butter text-ink",
  error: "bg-danger/10 text-danger"
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
  tone?: keyof typeof circles;
  className?: string;
}) {
  const small = size === "sm";
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center text-center",
        small ? "gap-2 p-4" : "gap-3 px-6 py-10",
        className
      )}
    >
      {!small && <Confetti className="max-w-[16rem]" />}
      <div
        className={cn(
          "flex items-center justify-center rounded-full",
          small ? "size-10" : "size-14",
          circles[tone]
        )}
      >
        <Icon className={small ? "size-5" : "size-7"} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <p className={cn("font-semibold text-ink", small ? "text-sm" : "text-xl")}>{title}</p>
      {description && (
        <p className={cn("max-w-sm text-ink-muted", small ? "text-xs" : "text-sm")}>{description}</p>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
