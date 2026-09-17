import { useState } from 'react';
import type { Priority } from '../api/tasks';

export interface BulkActionBarProps {
  count: number;
  busy?: boolean;
  /** People who can be assigned (for the reassign control). */
  assignees: { value: string; label: string }[];
  /** Move targets — only supplied when the selection is scoped to a single project. */
  columns?: { value: string; label: string }[];
  onComplete: () => void;
  onSetDueDate: (date: string | null) => void;
  onSetPriority: (priority: Priority) => void;
  onAssign: (userId: string) => void;
  onMove?: (columnId: string) => void;
  onClear: () => void;
}

const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'URGENT', label: 'Urgent' },
  { value: 'HIGH', label: 'High' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'LOW', label: 'Low' },
];

const selectClass =
  'rounded-lg border border-line bg-surface px-2 py-1 text-xs text-ink outline-none transition-colors focus:border-brand disabled:opacity-50';

/** Floating bar of bulk actions for a multi-selected set of tasks (My Tasks). */
export function BulkActionBar({ count, busy = false, assignees, columns, onComplete, onSetDueDate, onSetPriority, onAssign, onMove, onClear }: BulkActionBarProps) {
  const [due, setDue] = useState('');

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface/95 px-3 py-2 shadow-lift backdrop-blur">
        <span className="flex items-center gap-2 pr-1 text-sm font-semibold text-ink">
          {busy ? <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand/30 border-t-brand" aria-hidden /> : null}
          {count} selected
        </span>
        <span className="h-5 w-px bg-line" aria-hidden />

        <button
          onClick={onComplete}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-2.5 py-1 text-xs font-semibold text-success transition-colors hover:bg-success/20 disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
          Complete
        </button>

        <label className="inline-flex items-center gap-1 text-xs text-ink-2">
          <span className="sr-only">Set due date</span>
          <input
            type="date"
            aria-label="Set due date"
            value={due}
            disabled={busy}
            onChange={(e) => { setDue(e.target.value); onSetDueDate(e.target.value || null); }}
            className={selectClass}
          />
        </label>

        <select aria-label="Set priority" disabled={busy} value="" onChange={(e) => { if (e.target.value) onSetPriority(e.target.value as Priority); }} className={selectClass}>
          <option value="">Priority…</option>
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>

        <select aria-label="Assign to" disabled={busy || assignees.length === 0} value="" onChange={(e) => { if (e.target.value) onAssign(e.target.value); }} className={selectClass}>
          <option value="">Assign to…</option>
          {assignees.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>

        {columns && onMove ? (
          <select aria-label="Move to" disabled={busy} value="" onChange={(e) => { if (e.target.value) onMove(e.target.value); }} className={selectClass}>
            <option value="">Move to…</option>
            {columns.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        ) : null}

        <span className="h-5 w-px bg-line" aria-hidden />
        <button onClick={onClear} aria-label="Clear selection" className="rounded-lg px-2 py-1 text-xs font-medium text-ink-2 transition-colors hover:bg-ground hover:text-ink">
          Clear
        </button>
      </div>
    </div>
  );
}
