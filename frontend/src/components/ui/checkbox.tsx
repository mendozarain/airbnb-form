import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded border border-slate-400 bg-white data-[state=checked]:border-brand-600 data-[state=checked]:bg-brand-600",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check className="size-4 text-white" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
