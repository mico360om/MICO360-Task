import type { ReactNode } from 'react';
import type { ProjectHealth } from '../../api/planning';
import { HEALTH_LABEL, initialsOf } from '../../lib/timeline';

/** The chart's left column and the weeks, the same in every row. */
export const ROW = 'grid grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)]';

/** Small stroke icons, drawn in the current colour. */
export function Glyph({ children, size = 14, className = '' }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`flex-none ${className}`}>
      {children}
    </svg>
  );
}

export const ICONS = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  warning: (
    <>
      <path d="M12 3.5 2.5 20h19z" />
      <path d="M12 10v4.5M12 17.6v.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M9.5 2.5h5" />
    </>
  ),
  list: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M7.5 9h9M7.5 12.5h9M7.5 16h5" />
    </>
  ),
  diamond: <path d="M12 3.5 20.5 12 12 20.5 3.5 12z" />,
  meeting: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
};

const PILL: Record<ProjectHealth, { tone: string; icon: ReactNode | null }> = {
  'on-track': { tone: 'bg-success-soft text-success', icon: ICONS.check },
  'at-risk': { tone: 'bg-warning-soft text-warning', icon: ICONS.warning },
  late: { tone: 'bg-danger-soft text-danger', icon: ICONS.clock },
  'no-target': { tone: 'bg-ground text-ink-2', icon: null },
};

/** "✓ On track", "⚠ At risk", "⏱ Late", "No target": an icon and words, never colour alone. */
export function HealthPill({ health, className = '' }: { health: ProjectHealth; className?: string }) {
  const p = PILL[health];
  return (
    <span data-health={health} className={`inline-flex flex-none items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${p.tone} ${className}`}>
      {p.icon ? <Glyph size={12}>{p.icon}</Glyph> : null}
      {HEALTH_LABEL[health]}
    </span>
  );
}

/** The bar's colours for each status: the track and the done part. */
export const BAR_TONE: Record<ProjectHealth, { track: string; fill: string }> = {
  'on-track': { track: 'bg-info-soft ring-1 ring-inset ring-info/50', fill: 'bg-info' },
  'at-risk': { track: 'bg-warning-soft ring-[1.5px] ring-inset ring-warning', fill: 'bg-warning' },
  late: { track: 'bg-danger-soft ring-[1.5px] ring-inset ring-danger', fill: 'bg-danger' },
  'no-target': { track: 'bg-info-soft ring-1 ring-inset ring-info/40', fill: 'bg-info' },
};

/** Busy-week steps, quiet to busiest. */
export const HEAT: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-ground text-ink-3',
  1: 'bg-info/15 text-ink',
  2: 'bg-info/30 text-ink',
  3: 'bg-warning/30 text-ink',
  4: 'bg-danger/35 text-ink',
};

/** ▸ / ▾: shows or hides a project's tasks under it. */
export function ExpandButton({ name, expanded, onToggle, children, className = '' }: { name: string; expanded: boolean; onToggle: () => void; children?: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${expanded ? 'Hide' : 'Show'} the tasks of ${name}`}
      title={expanded ? 'Hide its tasks' : 'Show its tasks'}
      className={`inline-flex flex-none items-center justify-center gap-1 rounded-md text-ink-2 transition-colors hover:bg-ground hover:text-brand ${className}`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`flex-none transition-transform ${expanded ? 'rotate-90' : 'rtl:rotate-180'}`}>
        <path d="M9 6l6 6-6 6" />
      </svg>
      {children}
    </button>
  );
}

/** Who has a task: their initials (the names on hover and for screen readers). */
export function Initials({ people }: { people: { id: string; name: string }[] }) {
  if (people.length === 0) return null;
  const names = people.map((p) => p.name).join(', ');
  return (
    <span role="img" aria-label={`Assigned to ${names}`} title={names} className="flex flex-none -space-x-1 rtl:space-x-reverse">
      {people.slice(0, 3).map((p) => (
        <span key={p.id} className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-ground px-0.5 text-[9.5px] font-bold text-ink-2 ring-2 ring-surface">
          {initialsOf(p.name)}
        </span>
      ))}
      {people.length > 3 ? <span className="grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-ground px-0.5 text-[9.5px] font-bold text-ink-2 ring-2 ring-surface">+{people.length - 3}</span> : null}
    </span>
  );
}
