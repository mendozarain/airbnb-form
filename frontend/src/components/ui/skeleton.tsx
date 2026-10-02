import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({
  className,
  shape = "line",
  index = 0
}: {
  className?: string;
  shape?: "line" | "block" | "circle";
  /** Row index; makes the shimmer ripple down a list. */
  index?: number;
}) {
  return (
    <div
      aria-hidden="true"
      style={{ "--i": index } as CSSProperties}
      className={cn(
        "sg-skel",
        shape === "circle" ? "rounded-full" : shape === "block" ? "rounded-lg" : "rounded-full",
        className
      )}
    />
  );
}
