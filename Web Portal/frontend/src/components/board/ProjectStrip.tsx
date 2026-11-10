import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../api/client';
import type { ApiProject } from '../../api/projects';
import { projectHealthApi, projectHealthKey, type ProjectHealthDetail } from '../../api/project-health';
import { projectDates, projectPeople, projectPlace } from '../../lib/board-project-strip';
import { OVERDUE_CLASS } from '../../lib/colour-classes';
import { TOUCH_SQUARE, TOUCH_TALL } from '../../lib/touch';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { readUserValue, writeUserValue } from '../../lib/user-storage';
import { useAuthStore } from '../../stores/auth-store';
import { ProjectAvatar } from '../ProjectAvatar';
import { HealthBadge } from '../projects/HealthBadge';

/** Per person, on this device (lib/user-storage): the strip folded away ('folded'), or open (nothing kept). */
export const STRIP_PREF = 'board.projectStrip';
/** A window at least this wide shows the whole strip (a tablet wraps it); a phone starts with the short one. */
const ROOMY = '(min-width: 40em)';

const ICON = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, className: 'flex-none text-ink-3' };
const BUILDING = (
  <svg {...ICON}>
    <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3" />
  </svg>
);
const PERSON = (
  <svg {...ICON}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </svg>
);
const CALENDAR = (
  <svg {...ICON}>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M3 9h18M8 2v4M16 2v4" />
  </svg>
);

/** One fact: an icon, the words (whole on hover), and what it is for screen readers. */
function Fact({ icon, label, text, children }: { icon: ReactNode; label: string; text: string; children?: ReactNode }) {
  return (
    <span title={`${label}: ${text}`} className="flex min-w-0 max-w-full items-center gap-1.5 text-xs text-ink-2">
      {icon}
      <span className="sr-only">{label}: </span>
      <span dir="auto" className="min-w-0 truncate">{children ?? text}</span>
    </span>
  );
}

function Progress({ health, color }: { health: ProjectHealthDetail; color: string }) {
  const { pct, mode } = health.completion;
  const label = mode === 'WEIGHT' ? 'Progress, by weight' : 'Progress';
  return (
    <span className="flex flex-none items-center gap-1.5" title={`${label}: ${pct}%`}>
      <span role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="block h-1.5 w-16 overflow-hidden rounded-full bg-ground sm:w-20">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </span>
      <span className="text-xs font-semibold tabular-nums text-ink">{pct}%</span>
    </span>
  );
}

/**
 * The Kanban board's project strip (owner, 10 Nov 2026): when ONE project is chosen on the Kanban Board
 * page, a slim line of its basics above the columns — its picture, name and number, client (or company),
 * project manager(s), dates with the days left, health (1.23.5's mark and reasons), progress in its own
 * completion mode, open and overdue tasks, and Open project. It folds away to the short line (picture,
 * name, health, progress), remembered for the person on this device; a tablet wraps it; a phone starts
 * with the short line and a Details button. Its health and figures are the project page's
 * (GET /projects/:id/health, kept fresh by every task change); without them the rest still shows.
 */
export function ProjectStrip({ project, today, timeZone }: { project: ApiProject; today: string; timeZone: string }) {
  const userId = useAuthStore((s) => s.user?.id);
  const roomy = useMediaQuery(ROOMY, true);
  const [folded, setFolded] = useState(() => readUserValue(userId, STRIP_PREF) === 'folded');
  const [phoneOpen, setPhoneOpen] = useState(false);
  const healthQ = useQuery({ queryKey: projectHealthKey(project.id), queryFn: () => projectHealthApi(apiClient).health(project.id), staleTime: 15_000 });
  const health = healthQ.data && healthQ.data.projectId === project.id ? healthQ.data : null;
  const open = roomy ? !folded : phoneOpen;
  const toggle = () => {
    if (!roomy) {
      setPhoneOpen((o) => !o);
      return;
    }
    const next = !folded;
    setFolded(next);
    writeUserValue(userId, STRIP_PREF, next ? 'folded' : null);
  };

  const name = (
    <span className="flex min-w-0 items-center gap-2">
      <ProjectAvatar project={project} size={open ? 'sm' : 'xs'} />
      <span dir="auto" title={project.name} className="min-w-0 truncate text-sm font-semibold text-ink">{project.name}</span>
    </span>
  );
  const healthMark = health ? <HealthBadge rag={health.rag} reasons={health.reasons} projectName={project.name} /> : null;
  const progress = health ? <Progress health={health} color={project.color || '#8B1E1E'} /> : null;
  const button = (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      aria-label="Project details"
      title={open ? 'Hide project details' : 'Show project details'}
      className={`flex flex-none items-center justify-center gap-1 rounded-lg px-1.5 text-xs font-semibold text-ink-2 transition-colors hover:bg-ground hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${roomy ? `h-7 ${TOUCH_SQUARE}` : TOUCH_TALL}`}
    >
      {/* On a phone the button says what it is ("Details"); elsewhere it is the small chevron at the line's end. */}
      {roomy ? null : <span>Details</span>}
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`}>
        <path d="m6 9 6 6 6-6" />
      </svg>
    </button>
  );
  // One frame for both: the button keeps its place in it, so folding or opening never loses the keyboard (review I2).
  const frame = (strip: 'short' | 'full', content: ReactNode) => (
    <section aria-label="Project details" data-project-strip={strip} className={`mb-3 flex flex-none items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm ${strip === 'short' ? 'py-1' : 'py-1.5'}`}>
      {content}
      {button}
    </section>
  );

  if (!open) {
    return frame(
      'short',
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {name}
        {healthMark}
        {progress}
      </div>,
    );
  }

  const place = projectPlace(project);
  const people = health ? projectPeople(health.owners) : null;
  const dates = projectDates(project, today, timeZone);
  const counts = health?.counts;
  return frame(
    'full',
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5">
      <span className="flex min-w-0 max-w-full items-center gap-2">
        {name}
        <span className="flex-none rounded bg-ground px-1.5 py-px font-mono text-[11px] text-ink-2" translate="no">{project.code}</span>
        {project.number ? (
          <span className="flex-none whitespace-nowrap text-xs text-ink-2">
            No. <bdi>{project.number}</bdi>
          </span>
        ) : null}
      </span>
      {place ? <Fact icon={BUILDING} label={place.label} text={place.name} /> : null}
      {people ? <Fact icon={PERSON} label={people.label} text={people.names} /> : null}
      {dates.range ? (
        <Fact icon={CALENDAR} label="Dates" text={dates.left ? `${dates.range} · ${dates.left.text}` : dates.range}>
          {dates.range}
          {dates.left ? (
            <>
              <span aria-hidden="true" className="text-ink-3"> · </span>
              <span className={dates.left.late ? `font-semibold ${OVERDUE_CLASS.text}` : ''}>{dates.left.text}</span>
            </>
          ) : null}
        </Fact>
      ) : null}
      {healthMark || progress ? (
        <span className="flex flex-none items-center gap-2">
          {healthMark}
          {progress}
        </span>
      ) : null}
      {counts ? (
        <span className="flex-none whitespace-nowrap text-xs text-ink-2">
          <span className="font-semibold tabular-nums text-ink">{counts.open}</span> open
          <span aria-hidden="true" className="text-ink-3"> · </span>
          <span className={counts.overdue > 0 ? `font-semibold ${OVERDUE_CLASS.text}` : ''}>
            <span className="tabular-nums">{counts.overdue}</span> overdue
          </span>
        </span>
      ) : null}
      <Link to={`/projects/${encodeURIComponent(project.id)}`} className={`ms-auto inline-flex flex-none items-center rounded px-1 text-xs font-semibold text-brand underline-offset-2 hover:underline ${TOUCH_TALL}`}>
        Open project
      </Link>
    </div>,
  );
}
