import { cn } from "@/lib/utils";

/** Floating white bar with the screen's single primary action. The only shadowed element. */
export function ActionBar({
  children,
  fixed = true,
  className
}: {
  children: React.ReactNode;
  /** Pin to the bottom of the viewport on mobile. */
  fixed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl bg-surface-raised p-3 shadow-float sm:p-4",
        fixed &&
          "fixed inset-x-3 bottom-[max(.75rem,env(safe-area-inset-bottom))] z-20 sm:static sm:inset-auto",
        className
      )}
    >
      {children}
    </div>
  );
}
