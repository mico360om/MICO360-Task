import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  /** Right-aligned actions (buttons, filters). */
  actions?: ReactNode;
}

/** Consistent page title block used across every page for a unified hierarchy. */
export function PageHeader({ title, subtitle, eyebrow, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 animate-fade-in-up sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1 text-brand">{eyebrow}</div> : null}
        <h1 className="font-display text-2xl font-extrabold tracking-tightish text-ink sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-2 sm:text-[15px]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
