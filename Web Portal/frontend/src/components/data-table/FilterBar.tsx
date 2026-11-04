import { SearchableSelect, type SelectOption } from '../ui/SearchableSelect';
import { DUE_FILTER_OPTIONS, EMPTY_TABLE_FILTERS, PRIORITY_FILTER_OPTIONS, tableFiltersActive, type TableFilters } from '../../lib/data-table';
import { TOUCH_TALL } from '../../lib/touch';

/**
 * The table's own filter bar (1.23.0), on pages that have no filters of their own (the Board page, a
 * project's Board tab, a meeting): words or a task number, status, person, priority and due date, a
 * Clear, and how many rows are shown ("12 of 40"). The page's own choices (its project, its day)
 * apply first; these narrow further.
 */
export function TableFilterBar({
  filters,
  onChange,
  statusOptions,
  personOptions,
  personLabel,
  showDue = true,
  shown,
  total,
  noun,
}: {
  filters: TableFilters;
  onChange: (next: TableFilters) => void;
  /** The status choices, the first being "any status" (value ''). */
  statusOptions: SelectOption[];
  /** The person choices, the first being "anyone" (value ''). */
  personOptions: SelectOption[];
  /** "assignee" or "owner": the person filter's name. */
  personLabel: string;
  showDue?: boolean;
  shown: number;
  total: number;
  /** ["task", "tasks"] — the count's word. */
  noun: [string, string];
}) {
  const set = (patch: Partial<TableFilters>) => onChange({ ...filters, ...patch });
  const active = tableFiltersActive(filters);
  const box = 'min-w-0 max-sm:flex-[1_1_calc(50%-0.25rem)] sm:w-40';
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <label className="relative min-w-0 max-sm:basis-full sm:w-56">
        <span className="sr-only">Filter rows</span>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          dir="auto"
          value={filters.text}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="Filter rows…"
          className="h-9 w-full rounded-lg border border-line bg-surface ps-8 pe-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 [@media(pointer:coarse)]:h-11"
        />
      </label>
      <div className={box}>
        <SearchableSelect ariaLabel="Filter by status" value={filters.status} onChange={(v) => set({ status: v })} options={statusOptions} />
      </div>
      <div className={box}>
        <SearchableSelect ariaLabel={`Filter by ${personLabel}`} value={filters.person} onChange={(v) => set({ person: v })} options={personOptions} />
      </div>
      <div className={box}>
        <SearchableSelect ariaLabel="Filter by priority" value={filters.priority} onChange={(v) => set({ priority: v })} options={PRIORITY_FILTER_OPTIONS} />
      </div>
      {showDue ? (
        <div className={box}>
          <SearchableSelect ariaLabel="Filter by due date" value={filters.due} onChange={(v) => set({ due: v })} options={DUE_FILTER_OPTIONS} />
        </div>
      ) : null}
      {active ? (
        <button type="button" onClick={() => onChange({ ...EMPTY_TABLE_FILTERS })} className={`rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ground hover:text-ink ${TOUCH_TALL}`}>
          Clear
        </button>
      ) : null}
      <p className="text-xs text-ink-2" aria-live="polite">
        {active ? `${shown} of ${total}` : `${total} ${total === 1 ? noun[0] : noun[1]}`}
      </p>
    </div>
  );
}
