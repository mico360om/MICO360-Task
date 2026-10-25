import type { ActivityRecord, ActivityRepository, CreateActivityData } from './activity-repository';
import { currentVia } from '../../lib/acting-via';

export interface ActivityServiceDeps {
  activities: ActivityRepository;
}

export function createActivityService({ activities }: ActivityServiceDeps) {
  /** A line written while MICO AI carries out a confirmed change says so (meta.via: "mico-ai"). */
  async function record(input: CreateActivityData): Promise<ActivityRecord> {
    const via = currentVia();
    if (!via) return activities.create(input);
    const meta = input.meta && typeof input.meta === 'object' && !Array.isArray(input.meta) ? (input.meta as Record<string, unknown>) : {};
    return activities.create({ ...input, meta: { ...meta, via } });
  }
  async function listForTask(taskId: string): Promise<ActivityRecord[]> {
    return activities.listForTask(taskId);
  }
  /** Newest activity; `projectIds` (when given) scopes it to those projects in the query. */
  async function listRecent(limit?: number, projectIds?: string[] | null): Promise<ActivityRecord[]> {
    return activities.listRecent(limit, projectIds);
  }
  return { record, listForTask, listRecent };
}

export type ActivityService = ReturnType<typeof createActivityService>;
