import { useEffect, useRef, useState } from 'react';
import { MEETING_STATUS_LABELS, type MeetingStatus } from '../../api/meetings';
import { fieldClass } from '../ui/Field';
import { DATE_RANGES, SORTS, type FilterChip, type MeetingFilters, type MeetingSort } from '../../lib/meeting-list';
import { useDismiss } from '../../lib/useDismiss';

const STATUSES: MeetingStatus[] = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'DRAFT', 'CANCELLED'];

const FUNNEL = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 5h16l-6 7.5V19l-4-2v-4.5z" />
  </svg>
);

/**
 * "Filters": project, date, status and sort in a small panel under the button, so they don't take
 * a row of the page. Escape or a click elsewhere closes it; the button counts the filters in use.
 */
export function FiltersButton({
  filters,
  sort,
  count,
  projects,
  onChange,
  onClearAll,
}: {
  filters: MeetingFilters;
  sort: MeetingSort;
  /** Filters in use (not counting the search or the sort). */
  count: number;
  projects: Array<{ id: string; name: string }>;
  onChange: (changes: Record<string, string | undefined>) => void;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLSelectElement>(null);
  useDismiss(open, () => setOpen(false), rootRef, buttonRef);
  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="meeting-filters"
        className={`inline-flex h-10 items-center gap-1.5 rounded-xl border bg-surface px-3 text-sm font-semibold transition-colors hover:border-brand ${open || count ? 'border-brand/60 text-brand' : 'border-line text-ink'}`}
      >
        {FUNNEL}
        Filters{count ? ` (${count})` : ''}
      </button>
      {open ? (
        <div
          id="meeting-filters"
          role="group"
          aria-label="Filter meetings"
          className="absolute start-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-3 shadow-lift animate-scale-in"
        >
          <div className="grid grid-cols-2 gap-x-2 gap-y-2.5">
            <div className="col-span-2 flex flex-col gap-1">
              <label htmlFor="ml-project" className="text-xs font-medium text-ink-2">Project</label>
              <select ref={firstRef} id="ml-project" value={filters.projectId} onChange={(e) => onChange({ project: e.target.value })} className={fieldClass(false)}>
                <option value="">All projects</option>
                <option value="none">Standalone only</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ml-date" className="text-xs font-medium text-ink-2">Date</label>
              <select id="ml-date" value={filters.range} onChange={(e) => onChange({ date: e.target.value })} className={fieldClass(false)}>
                {DATE_RANGES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="ml-status" className="text-xs font-medium text-ink-2">Status</label>
              <select id="ml-status" value={filters.status} onChange={(e) => onChange({ status: e.target.value })} className={fieldClass(false)}>
                <option value="ALL">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{MEETING_STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>
            {filters.range === 'custom' ? (
              <>
                <div className="flex flex-col gap-1">
                  <label htmlFor="ml-from" className="text-xs font-medium text-ink-2">From</label>
                  <input id="ml-from" type="date" value={filters.from ?? ''} onChange={(e) => onChange({ from: e.target.value })} className={fieldClass(false)} />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="ml-to" className="text-xs font-medium text-ink-2">To</label>
                  <input id="ml-to" type="date" value={filters.to ?? ''} min={filters.from} onChange={(e) => onChange({ to: e.target.value })} className={fieldClass(false)} />
                </div>
              </>
            ) : null}
            <div className="col-span-2 flex flex-col gap-1">
              <label htmlFor="ml-sort" className="text-xs font-medium text-ink-2">Sort by</label>
              <select id="ml-sort" value={sort} onChange={(e) => onChange({ sort: e.target.value })} className={fieldClass(false)}>
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
            <button type="button" onClick={onClearAll} className="rounded-lg px-2 py-1.5 text-sm font-medium text-ink-2 hover:text-brand">
              Reset
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg bg-brand-gradient px-4 py-1.5 text-sm font-semibold text-white shadow-brand">
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The filters in use as chips — each with ✕ to remove it — how many meetings match, and Clear all. */
export function FilterChips({ chips, summary, onRemove, onClearAll }: { chips: FilterChip[]; summary: string; onRemove: (key: FilterChip['key']) => void; onClearAll: () => void }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {chips.length ? (
        <ul aria-label="Filters in use" className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <li key={c.key} className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/[0.06] py-0.5 pe-1 ps-3 text-xs font-medium text-ink">
              <span>{c.label}</span>
              <button type="button" onClick={() => onRemove(c.key)} aria-label={`Remove ${c.label}`} className="grid h-5 w-5 place-items-center rounded-full text-ink-2 hover:bg-brand/15 hover:text-brand">
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p aria-live="polite" className="text-sm text-ink-2">{summary}</p>
      <button type="button" onClick={onClearAll} className="rounded-md px-1.5 text-sm font-medium text-brand hover:underline">
        Clear all
      </button>
    </div>
  );
}
