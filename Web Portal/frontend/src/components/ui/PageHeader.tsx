import type { ReactNode } from 'react';
import type { TrainingModule } from '../../api/training';
import { LearnLink } from '../training/LearnLink';

export interface PageHeaderProps {
  title: ReactNode;
  /** One line about the page, beside the title on a wide screen (hidden on smaller ones). */
  subtitle?: ReactNode;
  /** The page's section ("Workspace", "Admin"), shown before the title like a breadcrumb. */
  eyebrow?: ReactNode;
  /** Right-aligned actions (buttons, filters). */
  actions?: ReactNode;
  /**
   * Training Center: "Learn this feature" beside the title, opening this module's course (or its courses) — shown
   * only when there is one for this person.
   */
  learn?: TrainingModule;
}

/**
 * "Workspace / Meetings": the page's section and its title (the page's h1), on one line. A grid, so
 * that when the line is short the description (the last, 0–1fr column) gives way first and the title
 * (an auto column, which gets its full width before any fr column) only once the description is gone.
 * As flex items they shrank together, and Reports at 1280px read "Re…" beside a description.
 */
export function PageTitle({ title, subtitle, eyebrow, learn, className = '' }: Omit<PageHeaderProps, 'actions'> & { className?: string }) {
  // The Learn link has its own column after the title (empty, 0 wide, while it is hidden).
  const columns = eyebrow
    ? learn
      ? 'grid-cols-[auto_auto_auto_auto_minmax(0,1fr)]'
      : 'grid-cols-[auto_auto_auto_minmax(0,1fr)]'
    : learn
      ? 'grid-cols-[auto_auto_minmax(0,1fr)]'
      : 'grid-cols-[auto_minmax(0,1fr)]';
  return (
    <div data-page-title className={`grid min-w-0 items-baseline gap-x-2 ${columns} ${className}`}>
      {eyebrow ? (
        <>
          <span className="flex-none text-xs font-semibold uppercase tracking-wide text-ink-3">{eyebrow}</span>
          <span aria-hidden="true" className="flex-none text-ink-3">/</span>
        </>
      ) : null}
      <h1 className="min-w-0 truncate font-display text-xl font-extrabold tracking-tightish text-ink sm:text-2xl">{title}</h1>
      {learn ? (
        <span data-learn-slot className="flex-none self-center">
          <LearnLink module={learn} />
        </span>
      ) : null}
      {/* contain: inline-size — the description adds nothing to the line's natural width (it only fills
          what is left), so a header's actions make room for the title, not for the description. */}
      {subtitle ? <p className="ms-1 hidden min-w-0 truncate text-sm text-ink-3 [contain:inline-size] xl:block">{subtitle}</p> : null}
    </div>
  );
}

/**
 * Every list page's title: one compact line, "Workspace / Meetings", the page's one-line
 * description beside it where there is room, and its actions on the same row. The actions drop
 * below the title when there isn't room for both: the title asks for its whole width (it used to ask
 * for 16rem and be cut — "User & Profile Managem…" at 768px).
 *
 * The row is at least a button tall (40px; 44px on a touch screen), with or without actions: the
 * title sits at the same height on every page instead of moving a few pixels from page to page.
 */
export function PageHeader({ title, subtitle, eyebrow, actions, learn }: PageHeaderProps) {
  return (
    // Release B: items-start + a title line a button tall with its words centred — when the actions wrap (the Learn link
    // takes room), the title stays on their first line instead of floating between the two rows.
    <div data-page-header className="relative z-20 mb-4 flex min-h-10 flex-wrap items-start justify-between gap-x-4 gap-y-2 animate-fade-in-up [@media(pointer:coarse)]:min-h-11">
      <PageTitle title={title} subtitle={subtitle} eyebrow={eyebrow} learn={learn} className="min-h-10 flex-[1_1_auto] content-center [@media(pointer:coarse)]:min-h-11" />
      {actions ? <div data-page-actions className="flex min-h-10 max-w-full flex-wrap items-center gap-2 [@media(pointer:coarse)]:min-h-11">{actions}</div> : null}
    </div>
  );
}
