export function PageHeader({
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-[28px] leading-8 font-semibold tracking-tight text-ink sm:text-heading-xl">
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-2xl text-base text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
