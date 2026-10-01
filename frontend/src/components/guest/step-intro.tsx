import type { LucideIcon } from "lucide-react";

export function StepIntro({ icon: Icon, title, text }: { icon: LucideIcon; title: string; text: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon className="size-5" strokeWidth={1.5} aria-hidden="true" />
      </span>
      <div>
        <h2 className="text-xl font-semibold text-ink">{title}</h2>
        <p className="text-sm text-ink-muted">{text}</p>
      </div>
    </div>
  );
}

export function Checklist({ items }: { items: Array<{ icon: LucideIcon; text: string }> }) {
  return (
    <ul className="grid gap-4">
      {items.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-center gap-3 text-[15px] font-semibold text-ink">
          <Icon className="size-[22px] shrink-0 text-primary" strokeWidth={1.5} aria-hidden="true" />
          {text}
        </li>
      ))}
    </ul>
  );
}
