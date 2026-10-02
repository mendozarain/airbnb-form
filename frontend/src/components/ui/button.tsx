import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-full font-medium transition-[transform,background-color,color] duration-150 active:scale-[.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50 aria-busy:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary hover:bg-primary-hover",
        secondary: "bg-surface-sunken text-ink hover:bg-hairline",
        ghost: "text-ink hover:bg-surface-sunken",
        destructive: "bg-danger text-white hover:opacity-90",
        link: "h-auto min-h-0 rounded-md px-0 text-ink underline underline-offset-4 hover:text-ink-muted active:scale-100"
      },
      size: {
        default: "h-12 px-6 text-base",
        sm: "h-10 px-4 text-sm",
        lg: "h-14 px-8 text-lg",
        icon: "size-12 p-0"
      }
    },
    defaultVariants: { variant: "default", size: "default" }
  }
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /** Swaps the content for a spinner, keeps the button width and ignores taps. */
    loading?: boolean;
    loadingText?: string;
  };

export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  loadingText,
  children,
  ...props
}: Props) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild)
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    );
  return (
    <button className={classes} aria-busy={loading || undefined} disabled={props.disabled} {...props}>
      {loading ? (
        <>
          <span className="sg-spinner" aria-hidden="true" />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
