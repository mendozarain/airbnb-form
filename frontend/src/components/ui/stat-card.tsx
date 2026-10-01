import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const tones = {
  pink: "bg-pink",
  mint: "bg-mint",
  sky: "bg-sky",
  butter: "bg-butter"
} as const;

export function StatCard({
  tone,
  icon: Icon,
  label,
  value,
  hint,
  className
}: {
  tone: keyof typeof tones;
  icon?: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg p-6 text-ink", tones[tone], className)}>
      {Icon && <Icon className="mb-3 size-6" strokeWidth={1.5} aria-hidden="true" />}
      <p className="text-4xl font-bold leading-[52px] tracking-tight">{value}</p>
      <p className="text-lg font-semibold">{label}</p>
      {hint && <p className="mt-1 text-sm font-medium">{hint}</p>}
    </div>
  );
}
