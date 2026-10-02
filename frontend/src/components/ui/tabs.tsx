import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

/** White pill track; a black pill indicator slides to the active trigger. */
export function TabsList({ className, children, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const place = () => {
      const active = list.querySelector<HTMLElement>('[data-state="active"]');
      if (!active) return;
      list.style.setProperty("--x", `${active.offsetLeft}px`);
      list.style.setProperty("--w", `${active.offsetWidth}px`);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(list, { attributes: true, subtree: true, attributeFilter: ["data-state"] });
    const resize = new ResizeObserver(place);
    resize.observe(list);
    document.fonts?.ready.then(place);
    return () => {
      observer.disconnect();
      resize.disconnect();
    };
  }, []);
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "relative flex w-full gap-1 overflow-x-auto rounded-full bg-surface-raised p-1.5 before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-(--w,0) before:translate-x-(--x,0) before:rounded-full before:bg-primary before:transition-[transform,width] before:duration-[420ms] before:ease-(--ease-spring) before:content-['']",
        className
      )}
      {...props}
    >
      {children}
    </TabsPrimitive.List>
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "relative z-10 h-11 flex-1 whitespace-nowrap rounded-full px-5 text-base font-medium text-ink-muted transition-colors hover:text-ink data-[state=active]:text-on-primary",
        className
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("outline-none", className)} {...props} />;
}
