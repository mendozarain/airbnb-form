import { cn } from "@/lib/utils";

/** A bordered row of 2-4 label/value pairs. `soft` is for use inside the status hero. */
export function StatGrid({
  items,
  soft,
  className
}: {
  items: Array<{ label: string; value: string; mono?: boolean }>;
  soft?: boolean;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid overflow-hidden rounded-md border",
        soft ? "border-ink-on-soft/60" : "border-hairline",
        items.length === 4
          ? "grid-cols-2 sm:grid-cols-4"
          : items.length === 3
            ? "grid-cols-3"
            : "grid-cols-2",
        className
      )}
    >
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            "min-w-0 px-4 py-3",
            index > 0 && (soft ? "border-l border-ink-on-soft/60" : "border-l border-hairline"),
            items.length === 4 && index > 1 && "max-sm:border-t",
            items.length === 4 && index === 2 && "max-sm:border-l-0"
          )}
        >
          <dt className={cn("truncate text-sm", soft ? "text-ink-on-soft" : "text-ink-muted")}>
            {item.label}
          </dt>
          <dd
            className={cn(
              "mt-0.5 break-words font-medium text-ink",
              item.mono ? "text-mono" : "text-[17px] leading-6"
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
