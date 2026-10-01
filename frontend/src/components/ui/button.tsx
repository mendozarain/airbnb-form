import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-on-primary shadow-button hover:bg-primary-hover",
        secondary:
          "bg-surface-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-primary-soft",
        ghost: "text-ink hover:bg-primary-soft",
        destructive: "bg-danger text-white hover:opacity-90",
        link: "h-auto min-h-0 px-0 text-primary hover:text-primary-hover hover:underline"
      },
      size: {
        default: "h-10 px-4 text-sm",
        sm: "h-9 px-3 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "size-10 p-0"
      }
    },
    defaultVariants: { variant: "default", size: "default" }
  }
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...props }: Props) {
  const Component = asChild ? Slot : "button";
  return <Component className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
