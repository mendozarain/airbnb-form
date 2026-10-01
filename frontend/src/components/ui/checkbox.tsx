import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-sm border border-line-strong bg-surface-raised data-[state=checked]:border-primary data-[state=checked]:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-4 text-on-primary" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
