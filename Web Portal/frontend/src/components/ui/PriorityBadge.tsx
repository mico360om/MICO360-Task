import { PRIORITY_CLASS } from '../../lib/colour-classes';

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

const LABEL: Record<Priority, string> = { LOW: 'Low', NORMAL: 'Normal', HIGH: 'High', URGENT: 'Urgent' };

/**
 * A priority pill in the one colour scheme (1.23.8, lib/colour-classes): Urgent red · High orange ·
 * Normal blue-grey · Low grey — a soft tint with the word on it (never colour alone), light and dark.
 */
export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span data-priority={priority} className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${(PRIORITY_CLASS[priority] ?? PRIORITY_CLASS.NORMAL).chip}`}>
      {LABEL[priority]}
    </span>
  );
}
