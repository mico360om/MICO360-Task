import type { Priority } from '../api/tasks';
import type { SelectOption } from './ui/SearchableSelect';

export const PRIORITIES: Priority[] = ['LOW', 'NORMAL', 'HIGH', 'URGENT'];

const META: Record<Priority, { label: string; bars: number; tone: string }> = {
  LOW: { label: 'Low', bars: 1, tone: 'text-ink-3' },
  NORMAL: { label: 'Normal', bars: 2, tone: 'text-info' },
  HIGH: { label: 'High', bars: 3, tone: 'text-warning' },
  URGENT: { label: 'Urgent', bars: 4, tone: 'text-danger' },
};

export const priorityLabel = (p: Priority) => META[p].label;

/** Signal-style bars: one for Low up to four for Urgent, in the priority's colour. */
export function PriorityBars({ priority }: { priority: Priority }) {
  const m = META[priority];
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" className={m.tone} aria-hidden="true">
      {[0, 1, 2, 3].map((i) => <rect key={i} x={1 + i * 4} y={12 - i * 3} width="3" height={3 + i * 3} rx="0.8" fill="currentColor" opacity={i < m.bars ? 1 : 0.25} />)}
    </svg>
  );
}

/** The priorities as picker choices, each with its bars. */
export function priorityOptions(): SelectOption[] {
  return PRIORITIES.map((p) => ({ value: p, label: META[p].label, icon: <PriorityBars priority={p} /> }));
}
