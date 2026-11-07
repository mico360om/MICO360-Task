import { statusClass } from '../../lib/colour-classes';
import { statusMeta } from '../../lib/taskStatus';

/**
 * A task's status as a pill in the one colour scheme (1.23.8, lib/colour-classes): its kind's soft tint, a dot
 * and its name in the kind's colour — Backlog grey · To do slate · In progress blue · Blocked red · Review
 * purple · Done green. `label`: the column's own name (else the kind's).
 */
export function StatusPill({ category, label, className = '', testId }: { category?: string | null; label?: string | null; className?: string; testId?: string }) {
  const tone = statusClass(category);
  return (
    <span data-testid={testId} data-status={category ?? 'TODO'} className={`inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone.chip} ${className}`}>
      <span className={`h-1.5 w-1.5 flex-none rounded-full ${tone.dot}`} aria-hidden="true" />
      <span dir="auto" className="truncate">{label || statusMeta(category).label}</span>
    </span>
  );
}
