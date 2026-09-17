export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

const LABEL: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

// Semantic tokens (matching ui/Badge tones) so priority pills are theme-aware
// and consistent with every other status pill in the app.
const CLASS: Record<Priority, string> = {
  LOW: 'bg-ground text-ink-2',
  NORMAL: 'bg-ground text-ink',
  HIGH: 'bg-warning-soft text-warning',
  URGENT: 'bg-danger-soft text-danger',
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span data-priority={priority} className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${CLASS[priority]}`}>
      {LABEL[priority]}
    </span>
  );
}
