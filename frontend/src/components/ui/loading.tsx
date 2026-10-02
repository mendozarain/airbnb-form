import type { CSSProperties, ReactNode } from "react";
import { useLoadingMessage } from "@/lib/use-loading";
import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";

/** Spinner chip with a present-tense label. */
export function LoadingChip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-surface-sunken pl-2 pr-3 text-sm font-medium text-ink-muted",
        className
      )}
    >
      <span className="sg-spinner sg-spinner--ring size-4" aria-hidden="true" />
      <span className="min-w-0 truncate" key={label}>
        {label}
      </span>
    </span>
  );
}

/**
 * A card that mirrors the content that is loading: yellow bar sweeping the top edge, a spinner
 * chip in the header and skeleton rows underneath. Never a bare skeleton.
 */
export function LoadingCard({
  label,
  rows = 4,
  title = true,
  className,
  children
}: {
  label: string;
  rows?: number;
  title?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const message = useLoadingMessage(label);
  return (
    <section
      aria-busy="true"
      className={cn("relative overflow-hidden rounded-xl bg-surface-raised p-5 sm:p-6", className)}
    >
      <div className="sg-loadbar" aria-hidden="true" />
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        {title ? (
          <div className="min-w-0 flex-1 space-y-2.5">
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-3.5 w-3/4" />
          </div>
        ) : (
          <span />
        )}
        <LoadingChip label={message} />
      </div>
      {children ?? <SkeletonRows rows={rows} />}
    </section>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          style={{ "--i": index } as CSSProperties}
          className="sg-row flex items-center gap-4 rounded-lg bg-surface-sunken px-5 py-4"
        >
          <Skeleton shape="circle" index={index} className="size-11 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton index={index} className="h-4 w-1/2" />
            <Skeleton index={index} className="h-3 w-1/3" />
          </div>
          <Skeleton index={index} className="hidden h-8 w-24 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Whole screen, nothing to mirror yet. */
export function LoadingBlock({ label, className }: { label: string; className?: string }) {
  const message = useLoadingMessage(label);
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-3 p-10 text-center text-[15px] text-ink-muted",
        className
      )}
    >
      <span className="sg-spinner sg-spinner--ring size-8 border-[3px]" aria-hidden="true" />
      <span key={message} className="sg-fade-in max-w-xs">
        {message}
      </span>
    </div>
  );
}

export function Dots({ className }: { className?: string }) {
  return (
    <span className={cn("sg-dots", className)} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

/** Error card with a retry, for failed first loads. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <section role="alert" className="rounded-xl bg-surface-raised p-6 text-center">
      <p className="text-title text-ink">Could not load this page</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 h-10 rounded-full bg-primary px-5 text-sm font-medium text-on-primary active:scale-[.96]"
      >
        Try again
      </button>
    </section>
  );
}
