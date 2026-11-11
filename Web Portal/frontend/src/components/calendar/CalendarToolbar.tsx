import { useRef, useState, type ReactNode } from 'react';
import { useDismiss } from '../../lib/useDismiss';
import type { CalendarView } from '../../lib/calendar';
import { SearchableSelect, type SelectOption } from '../ui/SearchableSelect';
import { DEFAULT_FILTERS, PRIORITIES, STATUS_FILTERS, activeFilterCount, type CalendarFilters } from '../../lib/calendar-model';
import { PRIORITY_LABEL, STATUS_META } from './calendar-ui';
import { useShortcutHint } from '../shortcuts/ShortcutProvider';

const VIEWS: { v: CalendarView; label: string }[] = [
  { v: 'month', label: 'Month' },
  { v: 'week', label: 'Week' },
  { v: 'day', label: 'Day' },
  { v: 'agenda', label: 'Agenda' },
];

// 44px on a touch screen (a tablet or phone), the dense 36px with a mouse.
const iconButton = 'grid h-9 w-9 flex-none place-items-center rounded-xl border border-line bg-surface text-ink-2 transition-colors hover:border-brand hover:text-brand [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';
const pill = 'h-9 whitespace-nowrap rounded-xl border px-3 text-sm font-semibold transition-colors [@media(pointer:coarse)]:h-11';

/**
 * Previous / today / next and the period shown on the left; the views, a date to jump to and
 * "+ Task" on the right. Its two groups join the title's line (display: contents), so where there
 * isn't room the right-hand group moves to the next line whole.
 */
export function CalendarToolbar({ view, onView, period, unit, onPrev, onNext, onToday, cursor, onGoTo, onNew, layout, onLayout }: {
  view: CalendarView;
  onView: (v: CalendarView) => void;
  period: string;
  /** What Previous and Next step by. */
  unit: 'month' | 'week' | 'day';
  /** Calendar scheduling: the split view (≥ 1280 px) — the calendar left, the chosen day's list right; or the full width. */
  layout?: 'split' | 'full';
  onLayout?: (layout: 'split' | 'full') => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  cursor: string;
  onGoTo: (day: string) => void;
  onNew?: () => void;
}) {
  const newHint = useShortcutHint('new');
  return (
    <div className="contents">
      {/* On a very narrow phone the period goes under the buttons rather than squeezing "Today". */}
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <button type="button" onClick={onPrev} aria-label={`Previous ${unit}`} title={`Previous ${unit}`} className={iconButton}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="rtl:rotate-180"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <button type="button" onClick={onToday} className={`${pill} border-line bg-surface text-ink hover:border-brand hover:text-brand`}>Today</button>
        <button type="button" onClick={onNext} aria-label={`Next ${unit}`} title={`Next ${unit}`} className={iconButton}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="rtl:rotate-180"><path d="M9 18l6-6-6-6" /></svg>
        </button>
        <h2 aria-live="polite" className="ms-1.5 min-w-0 truncate font-display text-lg font-bold text-ink">{period}</h2>
      </div>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {layout && onLayout ? (
          <div role="group" aria-label="Layout" className="inline-flex rounded-xl border border-line bg-surface p-0.5">
            {(['split', 'full'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => onLayout(l)}
                aria-pressed={layout === l}
                title={l === 'split' ? 'The calendar and the chosen day’s list side by side' : 'The calendar across the whole width'}
                className={`min-h-[2rem] rounded-lg px-3 text-sm font-semibold transition-colors ${layout === l ? 'bg-ink/10 text-ink' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
              >
                {l === 'split' ? 'Split' : 'Full'}
              </button>
            ))}
          </div>
        ) : null}
        <div role="group" aria-label="View" className="inline-flex rounded-xl border border-line bg-surface p-0.5 [@media(pointer:coarse)]:p-0">
          {VIEWS.map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => onView(v)}
              aria-pressed={view === v}
              className={`min-h-[2rem] rounded-lg px-3 text-sm font-semibold transition-colors [@media(pointer:coarse)]:!min-h-11 ${view === v ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="relative">
          <span className="sr-only">Go to date</span>
          <input
            type="date"
            aria-label="Go to date"
            value={cursor}
            onChange={(e) => e.target.value && onGoTo(e.target.value)}
            className="h-9 rounded-xl border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:h-11"
          />
        </label>
        {onNew ? (
          <button type="button" onClick={onNew} title={newHint ? newHint.title('New task') : undefined} aria-keyshortcuts={newHint?.aria} className="h-9 rounded-xl bg-brand-gradient px-3.5 text-sm font-semibold text-white shadow-brand max-sm:hidden [@media(pointer:coarse)]:h-11">+ Task</button>
        ) : null}
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex min-h-[2.25rem] cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-ink hover:bg-ground [@media(pointer:coarse)]:min-h-11">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--c-brand))]" />
      {label}
    </label>
  );
}

/**
 * Search, project, person, my tasks — and status, priority and what to include behind "More
 * filters". On a phone (`compact`) everything but the search sits behind one "Filters" button, so
 * the month stays in view. `trailing` (the legend) ends the row.
 */
export function CalendarFilterBar({ filters, onChange, projectOptions, assigneeOptions, compact = false, trailing }: {
  filters: CalendarFilters;
  onChange: (next: CalendarFilters) => void;
  projectOptions: SelectOption[];
  assigneeOptions: SelectOption[];
  compact?: boolean;
  trailing?: ReactNode;
}) {
  const [more, setMore] = useState(false);
  const set = (patch: Partial<CalendarFilters>) => onChange({ ...filters, ...patch });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const count = activeFilterCount(filters);
  const moreCount = (filters.statuses.length ? 1 : 0) + (filters.priorities.length ? 1 : 0) + (filters.showCompleted ? 0 : 1) + (filters.showArchived ? 1 : 0) + (filters.showProjected ? 0 : 1) + (filters.showMeetings ? 0 : 1);
  // What the button's panel holds: on a phone, every filter but the search.
  const panelCount = compact ? count - (filters.q.trim() ? 1 : 0) : moreCount;

  const project = (
    <div className={compact ? 'min-w-0' : 'w-[calc(50%-0.25rem)] sm:w-44 lg:w-36 xl:w-44'}>
      <SearchableSelect ariaLabel="Project" value={filters.projectId} onChange={(v) => set({ projectId: v })} options={projectOptions} />
    </div>
  );
  const assignee = (
    <div className={compact ? 'min-w-0' : 'w-[calc(50%-0.25rem)] sm:w-44 lg:w-36 xl:w-44'}>
      <SearchableSelect ariaLabel="Assignee" value={filters.assigneeId} onChange={(v) => set({ assigneeId: v })} options={assigneeOptions} />
    </div>
  );
  const mine = (
    <button
      type="button"
      onClick={() => set({ mine: !filters.mine })}
      aria-pressed={filters.mine}
      className={`${pill} ${filters.mine ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-ink hover:border-brand'}`}
    >
      My tasks
    </button>
  );
  const clear =
    count > 0 ? (
      <button type="button" onClick={() => onChange(DEFAULT_FILTERS)} className="h-9 rounded-xl px-2.5 text-sm font-semibold text-ink-2 underline-offset-2 hover:text-brand hover:underline [@media(pointer:coarse)]:h-11">
        Clear filters ({count})
      </button>
    ) : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className={`relative min-w-0 ${compact ? 'flex-1' : 'min-w-[9rem] flex-1 sm:max-w-[14rem]'}`}>
          <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-ink-2">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </span>
          <input
            type="search"
            data-page-search
            value={filters.q}
            onChange={(e) => set({ q: e.target.value })}
            aria-label="Search tasks"
            placeholder="Search tasks"
            className="h-9 w-full rounded-xl border border-line bg-surface pe-3 ps-9 text-sm text-ink outline-none placeholder:text-ink-2 focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:h-11"
          />
        </label>
        {compact ? null : (
          <>
            {project}
            {assignee}
            {mine}
          </>
        )}
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          aria-controls="calendar-more-filters"
          className={`${pill} ${more || panelCount ? 'border-brand/60 text-brand' : 'border-line text-ink'} bg-surface hover:border-brand`}
        >
          {compact ? 'Filters' : 'More filters'}
          {panelCount ? ` (${panelCount})` : ''}
        </button>
        {compact ? null : clear}
        {trailing ? <div className="ms-auto">{trailing}</div> : null}
      </div>
      {more ? (
        <div id="calendar-more-filters" className="grid gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-3">
          {compact ? (
            <div className="flex flex-col gap-2">
              {project}
              {assignee}
              <div className="flex flex-wrap items-center gap-2">
                {mine}
                {clear}
              </div>
            </div>
          ) : null}
          <fieldset>
            <legend className="mb-1 px-2 text-xs font-bold uppercase tracking-wide text-ink-2">Status</legend>
            <div className="flex flex-wrap">
              {STATUS_FILTERS.map((s) => (
                <Check key={s} label={STATUS_META[s].label} checked={filters.statuses.includes(s)} onChange={() => set({ statuses: toggle(filters.statuses, s) })} />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 px-2 text-xs font-bold uppercase tracking-wide text-ink-2">Priority</legend>
            <div className="flex flex-wrap">
              {PRIORITIES.map((p) => (
                <Check key={p} label={PRIORITY_LABEL[p]} checked={filters.priorities.includes(p)} onChange={() => set({ priorities: toggle(filters.priorities, p) })} />
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 px-2 text-xs font-bold uppercase tracking-wide text-ink-2">Include</legend>
            <div className="flex flex-col">
              <Check label="Show completed tasks" checked={filters.showCompleted} onChange={(v) => set({ showCompleted: v })} />
              <Check label="Show tasks of archived projects" checked={filters.showArchived} onChange={(v) => set({ showArchived: v })} />
              <Check label="Show repeats not created yet" checked={filters.showProjected} onChange={(v) => set({ showProjected: v })} />
              {/* Calendar scheduling: meetings are shown or hidden in "Show" (the person's own choice); an old address's meetings=0 still hides them. */}
              {filters.showMeetings ? null : <Check label="Show meetings" checked={filters.showMeetings} onChange={(v) => set({ showMeetings: v })} />}
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}

export interface ShowChoices {
  tasks: boolean;
  meetings: boolean;
  blocks: boolean;
  reminders: boolean;
}

/**
 * Calendar scheduling: what the calendar shows — tasks, meetings, planned time (work blocks), reminders —
 * and, for whoever runs projects, the Team's planned time. Each person's own, remembered.
 */
export function ShowMenu({ show, onShow, team, onTeam }: { show: ShowChoices; onShow: (patch: Partial<ShowChoices>) => void; team?: { available: boolean; on: boolean }; onTeam?: (on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), rootRef, buttonRef);
  // A box changes the moment it's clicked; the page's saved choices take over again whenever they
  // change (the save came back, or failed and was put back).
  const teamOn = team?.on ?? false;
  const [mine, setMine] = useState({ show, teamOn });
  const [seen, setSeen] = useState({ show, teamOn });
  if (seen.show !== show || seen.teamOn !== teamOn) {
    setSeen({ show, teamOn });
    setMine({ show, teamOn });
  }
  const pick = (patch: Partial<ShowChoices>) => {
    setMine((m) => ({ ...m, show: { ...m.show, ...patch } }));
    onShow(patch);
  };
  const pickTeam = (on: boolean) => {
    setMine((m) => ({ ...m, teamOn: on }));
    onTeam?.(on);
  };
  const rows: { key: keyof ShowChoices; label: string }[] = [
    { key: 'tasks', label: 'Tasks' },
    { key: 'meetings', label: 'Meetings' },
    { key: 'blocks', label: 'Planned time' },
    { key: 'reminders', label: 'My reminders' },
  ];
  const hidden = rows.filter((r) => !mine.show[r.key]).length;
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="calendar-show"
        className={`${pill} ${open || hidden || mine.teamOn ? 'border-brand/60 text-brand' : 'border-line text-ink'} bg-surface hover:border-brand`}
      >
        Show{hidden ? ` (${4 - hidden} of 4)` : ''}
        {mine.teamOn ? ' · Team' : ''}
      </button>
      {open ? (
        <div id="calendar-show" className="absolute end-0 top-full z-30 mt-2 w-60 rounded-xl border border-line bg-surface p-2 shadow-lift animate-scale-in">
          <fieldset>
            <legend className="mb-1 px-2 text-xs font-bold uppercase tracking-wide text-ink-2">Show</legend>
            <div className="flex flex-col">
              {rows.map((r) => (
                <Check key={r.key} label={r.label} checked={mine.show[r.key]} onChange={(v) => pick({ [r.key]: v })} />
              ))}
            </div>
          </fieldset>
          {team?.available && onTeam ? (
            <fieldset className="mt-2 border-t border-line pt-2">
              <legend className="mb-1 px-2 text-xs font-bold uppercase tracking-wide text-ink-2">Projects you run</legend>
              <Check label="Team’s planned time" checked={mine.teamOn} onChange={pickTeam} />
            </fieldset>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
