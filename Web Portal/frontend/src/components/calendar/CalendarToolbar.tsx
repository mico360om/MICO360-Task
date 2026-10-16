import { useState } from 'react';
import type { CalendarView } from '../../lib/calendar';
import { SearchableSelect, type SelectOption } from '../ui/SearchableSelect';
import { DEFAULT_FILTERS, PRIORITIES, STATUS_FILTERS, activeFilterCount, type CalendarFilters } from '../../lib/calendar-model';
import { PRIORITY_LABEL, STATUS_META } from './calendar-ui';
import { useShortcutHint } from '../shortcuts/ShortcutProvider';

const VIEWS: { v: CalendarView; label: string }[] = [
  { v: 'month', label: 'Month' },
  { v: 'week', label: 'Week' },
  { v: 'agenda', label: 'Agenda' },
];

const iconButton = 'grid h-10 w-10 flex-none place-items-center rounded-xl border border-line bg-surface text-ink-2 transition-colors hover:border-brand hover:text-brand';

/** Views, previous / today / next, the period shown and a date to jump to — one bar. */
export function CalendarToolbar({ view, onView, period, unit, onPrev, onNext, onToday, cursor, onGoTo, onNew }: {
  view: CalendarView;
  onView: (v: CalendarView) => void;
  period: string;
  /** "month" or "week": what Previous and Next step by. */
  unit: 'month' | 'week';
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  cursor: string;
  onGoTo: (day: string) => void;
  onNew?: () => void;
}) {
  const newHint = useShortcutHint('new');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="View" className="inline-flex rounded-xl border border-line bg-surface p-1">
        {VIEWS.map(({ v, label }) => (
          <button
            key={v}
            type="button"
            onClick={() => onView(v)}
            aria-pressed={view === v}
            className={`min-h-[2.25rem] rounded-lg px-3.5 text-sm font-semibold transition-colors ${view === v ? 'bg-brand text-white shadow-brand' : 'text-ink-2 hover:bg-ground hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" onClick={onPrev} aria-label={`Previous ${unit}`} title={`Previous ${unit}`} className={iconButton}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="rtl:rotate-180"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <button type="button" onClick={onToday} className="h-10 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold text-ink transition-colors hover:border-brand hover:text-brand">Today</button>
        <button type="button" onClick={onNext} aria-label={`Next ${unit}`} title={`Next ${unit}`} className={iconButton}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true" className="rtl:rotate-180"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      </div>
      <h2 aria-live="polite" className="min-w-0 flex-1 truncate font-display text-xl font-bold text-ink sm:flex-none">{period}</h2>
      <div className="ms-auto flex items-center gap-2">
        <label className="relative">
          <span className="sr-only">Go to date</span>
          <input
            type="date"
            aria-label="Go to date"
            value={cursor}
            onChange={(e) => e.target.value && onGoTo(e.target.value)}
            className="h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
        {onNew ? (
          <button type="button" onClick={onNew} title={newHint ? newHint.title('New task') : undefined} aria-keyshortcuts={newHint?.aria} className="h-10 rounded-xl bg-brand-gradient px-4 text-sm font-semibold text-white shadow-brand">+ Task</button>
        ) : null}
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex min-h-[2.25rem] cursor-pointer items-center gap-2 rounded-lg px-2 text-sm text-ink hover:bg-ground">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--c-brand))]" />
      {label}
    </label>
  );
}

/** Search, project, person, my tasks — and status, priority and what to include behind "More filters". */
export function CalendarFilterBar({ filters, onChange, projectOptions, assigneeOptions }: {
  filters: CalendarFilters;
  onChange: (next: CalendarFilters) => void;
  projectOptions: SelectOption[];
  assigneeOptions: SelectOption[];
}) {
  const [more, setMore] = useState(false);
  const set = (patch: Partial<CalendarFilters>) => onChange({ ...filters, ...patch });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const count = activeFilterCount(filters);
  const moreCount = (filters.statuses.length ? 1 : 0) + (filters.priorities.length ? 1 : 0) + (filters.showCompleted ? 0 : 1) + (filters.showArchived ? 1 : 0) + (filters.showProjected ? 0 : 1) + (filters.showMeetings ? 0 : 1);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
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
            className="h-10 w-full rounded-xl border border-line bg-surface pe-3 ps-9 text-sm text-ink outline-none placeholder:text-ink-2 focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <div className="w-[calc(50%-0.25rem)] sm:w-48">
          <SearchableSelect ariaLabel="Project" value={filters.projectId} onChange={(v) => set({ projectId: v })} options={projectOptions} />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-48">
          <SearchableSelect ariaLabel="Assignee" value={filters.assigneeId} onChange={(v) => set({ assigneeId: v })} options={assigneeOptions} />
        </div>
        <button
          type="button"
          onClick={() => set({ mine: !filters.mine })}
          aria-pressed={filters.mine}
          className={`h-10 rounded-xl border px-3.5 text-sm font-semibold transition-colors ${filters.mine ? 'border-brand bg-brand/10 text-brand' : 'border-line bg-surface text-ink hover:border-brand'}`}
        >
          My tasks
        </button>
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          aria-controls="calendar-more-filters"
          className={`h-10 rounded-xl border px-3.5 text-sm font-semibold transition-colors ${more || moreCount ? 'border-brand/60 text-brand' : 'border-line text-ink'} bg-surface hover:border-brand`}
        >
          More filters{moreCount ? ` (${moreCount})` : ''}
        </button>
        {count > 0 ? (
          <button type="button" onClick={() => onChange(DEFAULT_FILTERS)} className="h-10 rounded-xl px-3 text-sm font-semibold text-ink-2 underline-offset-2 hover:text-brand hover:underline">
            Clear filters ({count})
          </button>
        ) : null}
      </div>
      {more ? (
        <div id="calendar-more-filters" className="grid gap-3 rounded-xl border border-line bg-surface p-3 sm:grid-cols-3">
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
              <Check label="Show meetings" checked={filters.showMeetings} onChange={(v) => set({ showMeetings: v })} />
            </div>
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
