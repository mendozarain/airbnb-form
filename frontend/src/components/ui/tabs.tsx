import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex w-full gap-1 overflow-x-auto border-b border-slate-200", className)}
      {...props}
    />
  );
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "h-11 whitespace-nowrap border-b-2 border-transparent px-3 text-sm font-medium text-slate-500 data-[state=active]:border-brand-600 data-[state=active]:text-brand-700",
        className
      )}
      {...props}
    />
  );
}
