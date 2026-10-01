import { cn } from "@/lib/utils";

const bits = [
  { x: 14, y: 20, w: 14, r: 30, c: "accent" },
  { x: 56, y: 8, w: 7, r: 0, c: "butter", dot: true },
  { x: 92, y: 22, w: 12, r: -35, c: "primary" },
  { x: 134, y: 10, w: 6, r: 0, c: "pink", dot: true },
  { x: 168, y: 24, w: 14, r: 20, c: "mint" },
  { x: 206, y: 8, w: 10, r: -25, c: "accent" },
  { x: 244, y: 22, w: 7, r: 0, c: "primary", dot: true },
  { x: 276, y: 10, w: 14, r: 40, c: "butter" },
  { x: 302, y: 24, w: 6, r: 0, c: "mint", dot: true }
] as const;

const fills: Record<string, string> = {
  accent: "var(--color-accent)",
  butter: "var(--color-butter)",
  primary: "var(--color-primary)",
  pink: "var(--color-pink)",
  mint: "var(--color-mint)"
};

/** Decorative scattered dashes and dots. A small band above greetings and heroes only. */
export function Confetti({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 320 36"
      className={cn("pointer-events-none mx-auto mb-3 block h-9 w-full max-w-xs", className)}
    >
      {bits.map((bit, i) =>
        "dot" in bit ? (
          <circle key={i} cx={bit.x} cy={bit.y} r={bit.w / 2} fill={fills[bit.c]} />
        ) : (
          <rect
            key={i}
            x={bit.x}
            y={bit.y}
            width={bit.w}
            height={4}
            rx={2}
            fill={fills[bit.c]}
            transform={`rotate(${bit.r} ${bit.x + bit.w / 2} ${bit.y + 2})`}
          />
        )
      )}
    </svg>
  );
}
