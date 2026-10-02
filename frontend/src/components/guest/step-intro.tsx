import type { LucideIcon } from "lucide-react";

export function StepIntro({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="mb-5 flex items-start gap-4">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-surface-sunken text-ink">
        <Icon className="size-6" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-[22px] leading-7 font-semibold tracking-tight text-ink">{title}</h2>
        <p className="mt-1 text-base text-ink-muted">{text}</p>
      </div>
    </div>
  );
}

export function Checklist({ items }: { items: Array<{ icon: LucideIcon; text: string }> }) {
  return (
    <ul className="grid gap-4">
      {items.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-center gap-3 text-base font-medium text-ink">
          <Icon className="size-[22px] shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
  );
}
