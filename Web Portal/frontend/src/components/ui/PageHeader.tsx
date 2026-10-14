import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  eyebrow?: ReactNode;
  /** Right-aligned actions (buttons, filters). */
  actions?: ReactNode;
}

/**
 * Consistent page title block used across every page for a unified hierarchy.
 * The actions sit beside the title only when there is room for both: the title block asks for at
 * least 24rem, so a long row of buttons drops to its own line instead of squeezing the title (or
 * being squeezed into a narrow column of two-line buttons) on a tablet.
 */
export function PageHeader({ title, subtitle, eyebrow, actions }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 animate-fade-in-up">
      <div className="min-w-0 flex-[1_1_24rem]">
        {eyebrow ? <div className="eyebrow mb-1 text-brand">{eyebrow}</div> : null}
        <h1 className="font-display text-2xl font-extrabold tracking-tightish text-ink sm:text-3xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-ink-2 sm:text-[15px]">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
