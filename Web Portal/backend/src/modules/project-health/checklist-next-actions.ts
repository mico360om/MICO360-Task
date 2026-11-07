import type { PrioritySource } from '../dashboard/priority-sources';
import type { NextActionItemSource } from './health-service';
import type { ItemActionCandidate } from './next-actions';
import type { PriorityRowData } from '../dashboard/priority-sources';

/**
 * 1.23.5 × 1.23.3 (design call 4): a project's Next actions take the person's own checklist items from the
 * Dashboard's checklist source (createChecklistPrioritySource: open items assigned to them, overdue or due
 * within 3 days), scoped to this project — the same rows, Tick and Reschedule as on the Dashboard.
 */
export function projectChecklistItems(sourceFor: (projectId: string) => PrioritySource): NextActionItemSource {
  return {
    async collect(projectId, ctx, viewer) {
      if (!viewer) return [];
      const rows = await sourceFor(projectId).collect({ viewer, pick: null, today: ctx.today, timeZone: ctx.timeZone });
      return rows
        .filter((r) => r.kind === 'checklist-item')
        .map(({ kind, id, key, priority, dueDate, createdAt, row }) => ({ kind, id, key, priority, dueDate, createdAt, row }) as ItemActionCandidate & { row: PriorityRowData });
    },
  };
}
