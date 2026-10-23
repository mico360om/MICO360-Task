import { useEffect, useRef, type KeyboardEvent } from 'react';
import { PROJECT_STATUSES, projectStatusLabel, type ApiProject, type ProjectStatus } from '../../api/projects';
import { Badge, badgeToneClass, type BadgeTone } from '../ui/Badge';
import { useMenu } from '../task-drawer/menus';

/** Each project status's colour, the same as on the project's own page. */
export const PROJECT_STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  PLANNING: 'info',
  ACTIVE: 'success',
  ON_HOLD: 'warning',
  COMPLETED: 'brand',
  ARCHIVED: 'neutral',
};

/**
 * A project's status as a small menu: the label is a button, and the menu lists the five statuses
 * with the current one ticked. Opening it focuses the current status; ↑/↓, Home and End move;
 * Enter or a click picks; Escape closes it and returns to the button. Without `onChange` (someone
 * who may not change the status) it is a plain label.
 */
export function ProjectStatusMenu({
  project,
  onChange,
  className = '',
}: {
  project: Pick<ApiProject, 'name' | 'status'>;
  onChange?: (status: ProjectStatus) => void;
  className?: string;
}) {
  const { open, setOpen, wrap, trigger } = useMenu();
  const menuRef = useRef<HTMLDivElement>(null);
  const label = projectStatusLabel(project.status);
  const tone = PROJECT_STATUS_TONE[project.status];

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [open]);

  if (!onChange) {
    return (
      <span className={className}>
        <Badge tone={tone} dot>{label}</Badge>
      </span>
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const all = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const at = all.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      all[(i + all.length) % all.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(all.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  }

  function pick(status: ProjectStatus) {
    setOpen(false);
    // Back to the button first, so a confirmation the change opens returns focus there.
    trigger.current?.focus();
    if (status !== project.status) onChange!(status);
  }

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status: ${label}. Change the status of ${project.name}`}
        title="Change the status"
        className={`inline-flex min-h-6 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide transition-shadow hover:ring-1 hover:ring-current ${badgeToneClass(tone)}`}
      >
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-current" aria-hidden="true" />
        {label}
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="-me-0.5 opacity-75">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Status of ${project.name}`}
          onKeyDown={onKeyDown}
          className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lift"
        >
          {PROJECT_STATUSES.map((s) => {
            const current = s === project.status;
            return (
              <button
                key={s}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                tabIndex={-1}
                onClick={() => pick(s)}
                className={`flex min-h-10 w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-ground focus-visible:bg-ground focus-visible:outline-none sm:min-h-0 sm:py-1.5 ${current ? 'font-semibold text-ink' : 'text-ink'}`}
              >
                <span className={`h-2 w-2 flex-none rounded-full ${DOT[s]}`} aria-hidden="true" />
                {projectStatusLabel(s)}
                {current ? (
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ms-auto text-brand">
                    <path d="M5 12.5 10 17l9-10" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/** The status's dot in the menu (fill colours, so they show in light and dark). */
const DOT: Record<ProjectStatus, string> = {
  PLANNING: 'bg-info',
  ACTIVE: 'bg-success',
  ON_HOLD: 'bg-warning',
  COMPLETED: 'bg-brand',
  ARCHIVED: 'bg-ink-3',
};
