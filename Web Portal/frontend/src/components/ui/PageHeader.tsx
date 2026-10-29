import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: ReactNode;
  /** One line about the page, beside the title on a wide screen (hidden on smaller ones). */
  subtitle?: ReactNode;
  /** The page's section ("Workspace", "Admin"), shown before the title like a breadcrumb. */
  eyebrow?: ReactNode;
  /** Right-aligned actions (buttons, filters). */
  actions?: ReactNode;
}

/**
 * "Workspace / Meetings": the page's section and its title (the page's h1), on one line. A grid, so
 * that when the line is short the description (the last, 0–1fr column) gives way first and the title
 * (an auto column, which gets its full width before any fr column) only once the description is gone.
 * As flex items they shrank together, and Reports at 1280px read "Re…" beside a description.
 */
export function PageTitle({ title, subtitle, eyebrow, className = '' }: Omit<PageHeaderProps, 'actions'> & { className?: string }) {
  const columns = eyebrow ? 'grid-cols-[auto_auto_auto_minmax(0,1fr)]' : 'grid-cols-[auto_minmax(0,1fr)]';
  return (
    <div data-page-title className={`grid min-w-0 items-baseline gap-x-2 ${columns} ${className}`}>
      {eyebrow ? (
        <>
          <span className="flex-none text-xs font-semibold uppercase tracking-wide text-ink-3">{eyebrow}</span>
          <span aria-hidden="true" className="flex-none text-ink-3">/</span>
        </>
      ) : null}
      <h1 className="min-w-0 truncate font-display text-xl font-extrabold tracking-tightish text-ink sm:text-2xl">{title}</h1>
      {subtitle ? <p className="ms-1 hidden min-w-0 truncate text-sm text-ink-3 xl:block">{subtitle}</p> : null}
    </div>
  );
}

/**
 * Every list page's title: one compact line, "Workspace / Meetings", the page's one-line
 * description beside it where there is room, and its actions on the same row. The actions drop
 * below the title only when there isn't room for both (the title asks for at least 16rem).
 */
export function PageHeader({ title, subtitle, eyebrow, actions }: PageHeaderProps) {
  return (
    <div className="relative z-20 mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 animate-fade-in-up">
      <PageTitle title={title} subtitle={subtitle} eyebrow={eyebrow} className="flex-[1_1_16rem]" />
      {actions ? <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
